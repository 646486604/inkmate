import { api } from './api';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function enablePush(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('这个浏览器不支持 Web Push');
  }
  if (!window.isSecureContext) {
    throw new Error('Web Push 需要 HTTPS 或 localhost');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('通知权限被拒绝，可以在浏览器设置里重新允许');
  }
  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    registration = await navigator.serviceWorker.register('/sw.js');
  }
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const key = existing ? null : (await api.pushKey()).publicKey;
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key ?? ''),
    }));
  await api.subscribePush(subscription.toJSON());
  return '通知已开启';
}

export async function disablePush(): Promise<string> {
  if (!('serviceWorker' in navigator)) return '这个浏览器不支持 Web Push';
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return '通知已经关闭';
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await api.unsubscribePush(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return '通知已关闭';
}

export async function hasPushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  return Boolean(await registration.pushManager.getSubscription());
}

export async function sendTestPush(): Promise<string> {
  const result = await api.testPush();
  return result.sent > 0 ? `已发送 ${result.sent} 条测试通知` : '还没有订阅，先开启通知';
}
