'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, Sparkles, X, Settings, Loader2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { SettingsDialog } from '@/components/settings';
import { storeImages } from '@/lib/utils/image-storage';
import { useSettingsStore } from '@/lib/store/settings';
import { hasUsableLLMProvider } from '@/lib/store/settings-validation';
import { useUserProfileStore } from '@/lib/store/user-profile';
import type { UserRequirements, PdfImage } from '@/lib/types/generation';

const log = createLogger('Solve');

// 讲题语义的 requirement 框架：引导大纲生成为"解题讲解"而非"讲主题"
const SOLVE_REQUIREMENT_TEMPLATE = `这是一道题目的照片。请先识别题目内容，然后为学生讲解这道题：
1) 先讲解解题所需的前置知识点；
2) 再一步步讲解解题过程；
3) 在适合的地方用交互式演示（如仿真/图示/3D）帮助理解；
4) 最后用测验检验掌握情况。`;

/**
 * 客户端压缩/降分辨率：把长边缩到 maxEdge、导出为 JPEG。
 * 目的是让后续 base64 请求体远低于 Vercel 4.5MB 上限。
 */
async function compressImage(file: File, maxEdge = 1600, quality = 0.85): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('解析图片失败'));
    image.src = dataUrl;
  });

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  const longest = Math.max(width, height);
  if (longest > maxEdge) {
    const scale = maxEdge / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl; // 极端兜底：拿不到 canvas 上下文就用原图
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export default function SolvePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const hasUsableProvider = hasUsableLLMProvider(providersConfig);

  const canGenerate = !!imageFile && hasUsableProvider && !submitting;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请上传图片文件');
      return;
    }
    setError(null);
    setImageFile(file);
    // 本地预览（原图 objectURL，不上传）
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const clearImage = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setImageFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGenerate = async () => {
    if (!imageFile) {
      setError('请先上传题目图片');
      return;
    }
    if (!hasUsableProvider) {
      setSettingsOpen(true);
      return;
    }

    setSubmitting(true);
    setError(null);

    // 拍题讲题固定为 1v1：强制单个预设 AI teacher，覆盖浏览器里可能残留的旧设置
    // （auto / 三人），确保本次生成的课堂 stage 只烙入 default-1，live 问答走单人路径。
    const settings = useSettingsStore.getState();
    settings.setAgentMode('preset');
    settings.setSelectedAgentIds(['default-1']);
    settings.setAgentSelectionIsUserSet(false);

    try {
      // 1) 读图 + 2) 客户端压缩
      const compressed = await compressImage(imageFile);

      // 3) 存入 IndexedDB，拿到 storageId（session_xxx_img_1）
      const storageIds = await storeImages([{ id: 'img_1', src: compressed, pageNumber: 1 }]);
      if (storageIds.length === 0) {
        throw new Error('图片存储失败，请重试');
      }

      // 4) 构造 pdfImages（src 留空，图在 IndexedDB）
      const pdfImages: PdfImage[] = [
        { id: 'img_1', src: '', pageNumber: 1, storageId: storageIds[0] },
      ];

      // requirement 讲题框架 + 用户补充提示
      const requirement =
        SOLVE_REQUIREMENT_TEMPLATE + (hint.trim() ? `\n\n补充提示：${hint.trim()}` : '');

      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        // 不默认开启 interactiveMode：交互式内容按需由大纲规划，避免产出过多 interactive 场景
      };

      // 5) 组装 GenerationSessionState（复用现有 generation-preview 流程）
      const sessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages,
        imageStorageIds: storageIds,
        pdfStorageKey: undefined, // 关键：跳过 PDF 解析步骤
        sceneOutlines: null,
        currentStep: 'generating' as const,
      };
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));

      // 6) 跳转到生成预览页，复用全链路
      router.push('/generation-preview');
    } catch (err) {
      log.error('准备拍题讲题生成失败:', err);
      setError(err instanceof Error ? err.message : '生成失败，请重试');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">拍题讲题</h1>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all group"
          aria-label="设置"
        >
          <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
        </button>
      </div>

      {/* 主体 */}
      <div className="flex-1 flex items-center justify-center px-4 pb-10">
        <div className="w-full max-w-lg">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 text-primary mb-2">
              <Sparkles className="w-5 h-5" />
              <span className="text-sm font-medium">上传题目，AI 交互式讲题</span>
            </div>
            <p className="text-sm text-muted-foreground">
              拍一张题目照片，自动生成讲解幻灯片、交互演示与巩固测验
            </p>
          </div>

          {/* 图片上传区 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          {previewUrl ? (
            <div className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="题目预览" className="w-full max-h-80 object-contain" />
              <button
                onClick={clearImage}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                aria-label="移除图片"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-12 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <ImagePlus className="w-10 h-10 text-gray-400" />
              <span className="text-sm text-gray-500 dark:text-gray-400">
                点击上传题目图片（支持拍照）
              </span>
            </button>
          )}

          {/* 可选文字提示 */}
          <textarea
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="可选：补充说明，例如“重点讲第二问”“我不懂受力分析”"
            rows={2}
            className="mt-4 w-full resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />

          {/* 未配置模型提示 */}
          {!hasUsableProvider && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
              尚未配置可用的大模型，请先在设置中配置视觉模型（如千问 qwen-vl-max）。
            </p>
          )}

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

          {/* 开始讲题 */}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={cn(
              'mt-5 w-full h-11 rounded-lg flex items-center justify-center gap-2 font-medium transition-all',
              canGenerate
                ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm cursor-pointer'
                : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>正在准备…</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>开始讲题</span>
              </>
            )}
          </button>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
