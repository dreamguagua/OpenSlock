/** 从粘贴事件里抽出图片文件(没有图片返回空数组,调用方据此决定是否 preventDefault)。 */
export function imagesFromClipboard(e: ClipboardEvent): File[] {
  return Array.from(e.clipboardData?.items ?? [])
    .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
    .map((it) => it.getAsFile())
    .filter((f): f is File => f !== null);
}
