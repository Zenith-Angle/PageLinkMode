export async function sendRuntimeMessageBestEffort(
  sendMessage: (message: unknown) => Promise<unknown>,
  message: unknown,
): Promise<void> {
  try {
    await sendMessage(message);
  } catch {
    // 调试记录属于尽力而为的数据；扩展重载会使旧页面的 runtime 通道自然失效。
  }
}
