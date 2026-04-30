import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const CACHE_DIR = join(process.cwd(), "cache");

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheFilePath(key: string): string {
  ensureCacheDir();
  // key may contain slashes, normalize to safe filename
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(CACHE_DIR, `${safeKey}.json`);
}

interface CacheEntry<T> {
  data: T;
  cachedAt: string; // ISO timestamp
}

/**
 * 从缓存读取数据
 * @param key 缓存键
 * @param maxAgeHours 最大过期时间（小时）
 * @returns 缓存数据或 null
 */
export function getCachedData<T>(key: string, maxAgeHours: number): T | null {
  const filepath = getCacheFilePath(key);
  if (!existsSync(filepath)) return null;

  try {
    const raw = readFileSync(filepath, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(raw);
    const cachedAt = new Date(entry.cachedAt);
    const now = new Date();
    const ageHours = (now.getTime() - cachedAt.getTime()) / (1000 * 60 * 60);

    if (ageHours > maxAgeHours) {
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * 写入缓存
 * @param key 缓存键
 * @param data 数据
 */
export function setCachedData<T>(key: string, data: T): void {
  const filepath = getCacheFilePath(key);
  const entry: CacheEntry<T> = {
    data,
    cachedAt: new Date().toISOString(),
  };
  writeFileSync(filepath, JSON.stringify(entry, null, 2), "utf-8");
}

/**
 * 构建缓存键
 * @param stockCode 股票代码
 * @param dataType 数据类型
 */
export function buildCacheKey(stockCode: string, dataType: string): string {
  const pureCode = stockCode.replace(/[^0-9a-zA-Z]/g, "");
  const today = new Date().toISOString().slice(0, 10);
  return `${pureCode}_${dataType}_${today}`;
}
