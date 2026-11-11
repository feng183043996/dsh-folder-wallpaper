/**
 * Host half of the folder wallpaper slideshow bundle.
 *
 * Routes on the interface origin (all of them require the session cookie the
 * browser already holds, so an image URL is not readable by other origins):
 *   GET  /dsh-wallpaper/manifest      -> JSON playlist + current settings
 *   GET  /dsh-wallpaper/image/<file>  -> one image from the configured folder
 *   POST /dsh-wallpaper/settings      -> persist settings into the plugin config
 *
 * Everything the user can change is declared in `Config`, so the plugin row in
 * Settings shows an editable form. The floating panel on the page is only a
 * live preview: saving it writes the same values back through `configEditor`,
 * which keeps the plugin config as the single source of truth.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-folder-wallpaper";
export const inject = ["webServer", "connection"];

const MANIFEST_PATH = "/dsh-wallpaper/manifest";
const IMAGE_PATH = "/dsh-wallpaper/image";
const IMAGE_PREFIX = IMAGE_PATH + "/";
const SETTINGS_PATH = "/dsh-wallpaper/settings";
const DEFAULT_DIRECTORY = path.join(homedir(), "Pictures");

const MIME_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".gif", "image/gif"],
]);

const DEFAULTS = {
  directory: DEFAULT_DIRECTORY,
  intervalMs: 20000,
  transitionMs: 1600,
  surfaceAlpha: 0.28,
  dim: 0.1,
  fit: "cover",
  blurPx: 0,
  panelBlur: 4,
  shuffle: false,
  enabled: [],
};

export const Config = z.object({
  directory: z
    .string()
    .default(DEFAULTS.directory)
    .description("照片文件夹的绝对路径，读取其中 jpg / png / webp / avif / gif 文件"),
  intervalMs: z
    .number()
    .min(1000)
    .max(3600000)
    .step(1000)
    .default(DEFAULTS.intervalMs)
    .description("轮播间隔，单位毫秒（1000–3600000）"),
  transitionMs: z
    .number()
    .min(0)
    .max(10000)
    .step(100)
    .default(DEFAULTS.transitionMs)
    .description("两张照片之间的淡入淡出时长，单位毫秒"),
  surfaceAlpha: z
    .number()
    .min(0)
    .max(1)
    .step(0.01)
    .default(DEFAULTS.surfaceAlpha)
    .description("界面面板的不透明度 0–1：越小照片越清楚，越大文字越好读"),
  panelBlur: z
    .number()
    .min(0)
    .max(40)
    .step(1)
    .default(DEFAULTS.panelBlur)
    .description("面板毛玻璃的模糊半径，单位像素（0 表示不模糊）"),
  dim: z
    .number()
    .min(0)
    .max(0.8)
    .step(0.01)
    .default(DEFAULTS.dim)
    .description("盖在照片上的黑色压暗遮罩强度 0–0.8"),
  blurPx: z
    .number()
    .min(0)
    .max(40)
    .step(1)
    .default(DEFAULTS.blurPx)
    .description("照片自身的模糊半径，单位像素（0 表示清晰）"),
  fit: z
    .union([z.const("cover"), z.const("contain")])
    .default(DEFAULTS.fit)
    .description("cover 铺满裁切；contain 完整显示"),
  shuffle: z.boolean().default(DEFAULTS.shuffle).description("每次加载时随机打乱播放顺序"),
  enabled: z
    .array(z.string())
    .default(DEFAULTS.enabled)
    .description("只轮播这些文件名；留空表示文件夹内全部文件"),
});

function settingsOf(config) {
  const raw = config !== null && typeof config === "object" ? config : {};
  const number = (value, fallback, min, max) => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  return {
    directory:
      typeof raw.directory === "string" && raw.directory.trim() !== ""
        ? raw.directory
        : DEFAULTS.directory,
    intervalMs: number(raw.intervalMs, DEFAULTS.intervalMs, 1000, 3600000),
    transitionMs: number(raw.transitionMs, DEFAULTS.transitionMs, 0, 10000),
    surfaceAlpha: number(raw.surfaceAlpha, DEFAULTS.surfaceAlpha, 0, 1),
    dim: number(raw.dim, DEFAULTS.dim, 0, 0.8),
    fit: raw.fit === "contain" ? "contain" : "cover",
    blurPx: number(raw.blurPx, DEFAULTS.blurPx, 0, 40),
    panelBlur: number(raw.panelBlur, DEFAULTS.panelBlur, 0, 40),
    shuffle: raw.shuffle === true,
    enabled: Array.isArray(raw.enabled)
      ? raw.enabled.filter((value) => typeof value === "string").slice(0, 2000)
      : [],
  };
}

function connectionOf(ctx) {
  return Reflect.get(ctx, "connection");
}

function rejected(ctx, req, res) {
  const connection = connectionOf(ctx);
  const rejection =
    connection !== undefined && typeof connection.requestRejection === "function"
      ? connection.requestRejection(req)
      : undefined;
  if (rejection === undefined) return false;
  res.statusCode = rejection;
  res.end();
  return true;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(text);
}

async function listImages(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!MIME_TYPES.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(entry.name);
  }
  files.sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN", { numeric: true, sensitivity: "base" }),
  );
  return files;
}

function imageUrl(file) {
  return IMAGE_PREFIX + encodeURIComponent(file);
}

const PATCHABLE_KEYS = [
  "directory",
  "intervalMs",
  "transitionMs",
  "surfaceAlpha",
  "panelBlur",
  "dim",
  "blurPx",
  "fit",
  "shuffle",
  "enabled",
];

export function apply(ctx, config) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: MANIFEST_PATH,
        handler: async (req, res) => {
          if (rejected(ctx, req, res)) return;
          const active = settingsOf(config);
          let files = await listImages(active.directory);
          if (active.shuffle) {
            files = files
              .map((file) => [Math.random(), file])
              .sort((left, right) => left[0] - right[0])
              .map((pair) => pair[1]);
          }
          sendJson(res, 200, {
            version: 3,
            intervalMs: active.intervalMs,
            transitionMs: active.transitionMs,
            surfaceAlpha: active.surfaceAlpha,
            dim: active.dim,
            fit: active.fit,
            blurPx: active.blurPx,
            panelBlur: active.panelBlur,
            shuffle: active.shuffle,
            enabled: active.enabled,
            directory: active.directory,
            images: files.map((file) => ({
              file,
              url: imageUrl(file),
            })),
          });
        },
      }),
    "dsh-wallpaper: GET manifest",
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: IMAGE_PATH,
        handler: async (req, res) => {
          if (rejected(ctx, req, res)) return;
          const pathname = new URL(String(req.url), "http://localhost").pathname;
          const requested = decodeURIComponent(pathname.slice(IMAGE_PATH.length + 1));
          if (requested === "" || requested.includes("\0")) {
            sendText(res, 404, "not found");
            return;
          }
          const base = path.resolve(settingsOf(config).directory);
          const target = path.resolve(base, requested);
          if (target !== base && !target.startsWith(base + path.sep)) {
            sendText(res, 403, "forbidden");
            return;
          }
          const contentType = MIME_TYPES.get(path.extname(target).toLowerCase());
          if (contentType === undefined) {
            sendText(res, 404, "not found");
            return;
          }
          let bytes;
          try {
            bytes = await fs.readFile(target);
          } catch {
            sendText(res, 404, "not found");
            return;
          }
          res.statusCode = 200;
          res.setHeader("content-type", contentType);
          res.setHeader("content-length", String(bytes.byteLength));
          res.setHeader("cache-control", "public, max-age=86400, immutable");
          res.end(bytes);
        },
      }),
    "dsh-wallpaper: GET image",
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: SETTINGS_PATH,
        handler: async (req, res) => {
          if (rejected(ctx, req, res)) return;
          if (req.method !== "POST") {
            res.setHeader("allow", "POST");
            sendText(res, 405, "method not allowed");
            return;
          }
          const chunks = [];
          let size = 0;
          await new Promise((resolve) => {
            req.on("data", (chunk) => {
              size += chunk.length;
              if (size <= 65536) chunks.push(chunk);
            });
            req.on("end", resolve);
            req.on("error", resolve);
          });
          let payload;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            sendText(res, 400, "invalid json");
            return;
          }
          if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
            sendText(res, 400, "invalid settings");
            return;
          }
          const patch = {};
          for (const key of PATCHABLE_KEYS) {
            if (Object.prototype.hasOwnProperty.call(payload, key)) patch[key] = payload[key];
          }
          const entry = Reflect.get(ctx, "fiber")?.entry;
          const editor = typeof ctx.get === "function" ? ctx.get("configEditor") : undefined;
          if (entry === undefined || editor === undefined) {
            sendText(res, 501, "configuration cannot be saved in this profile");
            return;
          }
          /* The write reconciles the plugin, which restarts this fiber: answer
             first, then persist, so the browser still gets a response. */
          sendJson(res, 202, { ok: true, patch });
          void editor
            .edit(entry, (current) => {
              const next = { ...current };
              for (const key of PATCHABLE_KEYS) {
                if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
              }
              return settingsOf(next);
            })
            .catch((error) => {
              console.warn("[dsh-folder-wallpaper] could not save settings:", error);
            });
        },
      }),
    "dsh-wallpaper: POST settings",
  );
}
