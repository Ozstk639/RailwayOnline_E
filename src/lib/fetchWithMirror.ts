/**
 * 支持多镜像源的数据获取工具
 * 自动尝试多个镜像源，任意一个成功即返回
 */

// GitHub 原始地址和镜像地址配置
const GITHUB_RAW_MIRRORS = [
  'https://raw.githubusercontent.com',
  'https://raw.kkgithub.com',
  'https://fastly.jsdelivr.net/gh',
];

/**
 * 将 GitHub raw URL 转换为各镜像源格式
 *
 * 原始格式: https://raw.githubusercontent.com/{owner}/{repo}/main/{path}
 * kkgithub: https://raw.kkgithub.com/{owner}/{repo}/main/{path}
 * jsdelivr: https://fastly.jsdelivr.net/gh/{owner}/{repo}@main/{path}
 */
function convertToMirrorUrl(originalUrl: string, mirror: string): string {
  // 解析原始 URL
  const match = originalUrl.match(
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
  );

  if (!match) {
    return originalUrl;
  }

  const [, owner, repo, branch, path] = match;

  if (mirror === 'https://raw.githubusercontent.com') {
    return originalUrl;
  }

  if (mirror === 'https://raw.kkgithub.com') {
    return `https://raw.kkgithub.com/${owner}/${repo}/${branch}/${path}`;
  }

  if (mirror === 'https://fastly.jsdelivr.net/gh') {
    return `https://fastly.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`;
  }

  return originalUrl;
}

// 加载进度回调类型
export interface LoadingProgress {
  stage: string;
  status: 'loading' | 'success' | 'error';
  message?: string;
}

export type ProgressCallback = (progress: LoadingProgress) => void;

/**
 * 从多个镜像源获取数据，任意一个成功即返回
 * @param url GitHub raw 原始 URL
 * @param stageName 加载阶段名称（用于进度显示）
 * @param onProgress 进度回调
 */
export async function fetchWithMirror<T>(
  url: string,
  stageName: string,
  onProgress?: ProgressCallback
): Promise<T> {
  onProgress?.({ stage: stageName, status: 'loading' });

  let lastError: Error | null = null;

  for (const mirror of GITHUB_RAW_MIRRORS) {
    const mirrorUrl = convertToMirrorUrl(url, mirror);

    try {
      const response = await fetch(mirrorUrl, {
        // 设置超时
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      onProgress?.({ stage: stageName, status: 'success' });
      return data as T;
    } catch (error) {
      lastError = error as Error;
      console.warn(`Mirror ${mirror} failed for ${stageName}:`, error);
      // 继续尝试下一个镜像
    }
  }

  // 所有镜像都失败
  onProgress?.({
    stage: stageName,
    status: 'error',
    message: lastError?.message || '所有镜像源均不可用'
  });
  throw new Error(`Failed to fetch ${stageName} from all mirrors: ${lastError?.message}`);
}

/**
 * 简单的 fetch 包装（用于本地资源）
 */
export async function fetchLocal<T>(
  url: string,
  stageName: string,
  onProgress?: ProgressCallback
): Promise<T> {
  onProgress?.({ stage: stageName, status: 'loading' });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    onProgress?.({ stage: stageName, status: 'success' });
    return data as T;
  } catch (error) {
    onProgress?.({
      stage: stageName,
      status: 'error',
      message: (error as Error).message
    });
    throw error;
  }
}
