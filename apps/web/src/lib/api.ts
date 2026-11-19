import type {
  CharacterInput,
  CharacterPatch,
  CharacterPublic,
  ChatIdentityInput,
  ChatPublic,
  DayPlanPublic,
  FactInput,
  FactPatch,
  FactPublic,
  MemoryPublic,
  MessagePage,
  MessagePublic,
  MomentCommentInput,
  MomentCommentPublic,
  MomentInput,
  MomentPublic,
  MusicCommentInput,
  MusicCommentPublic,
  MusicSession,
  MusicTrack,
  ProfilePatch,
  ProviderInput,
  ProviderModelsInput,
  ProviderPatch,
  ProviderPublic,
  PublicUser,
  StickerPublic,
  WorldBookEntryInput,
  WorldBookEntryPatch,
  WorldBookEntryPublic,
  WorldBookInput,
  WorldBookPatch,
  WorldBookPublic,
} from '@inkmate/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 常规请求 20 秒；上传和备份导入要读大文件，单独放宽 */
const DEFAULT_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }

  // 手机端网络容易半死不活：没有超时的话 UI 会永远转圈，这里统一兜底
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    let res: Response;
    try {
      res = await fetch(path, {
        credentials: 'include',
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) {
        if (signal?.aborted) throw new ApiError(0, '请求已取消');
        throw new ApiError(
          0,
          `请求超时（${Math.round(timeoutMs / 1000)} 秒没有响应），服务器可能卡住了，稍后重试`,
        );
      }
      throw new ApiError(0, '无法连接服务，请确认后端已经启动');
    }

    if (!res.ok) {
      let message = `请求失败（${res.status}）`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // ignore non-JSON error bodies
      }
      // 会话失效时，把界面踢回登录页；登录接口自己的 401 是密码错误，不算
      if (res.status === 401 && path !== '/api/auth/login') {
        window.dispatchEvent(new Event('inkmate:unauthorized'));
      }
      throw new ApiError(res.status, message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(0, `请求超时（${Math.round(timeoutMs / 1000)} 秒没有响应），稍后重试`);
    }
    throw new ApiError(0, '响应解析失败，请重试');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health', { timeoutMs: 5_000 }),
  me: () => request<{ user: PublicUser }>('/api/auth/me'),
  updateProfile: (patch: ProfilePatch) =>
    request<{ user: PublicUser }>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  login: (password: string) =>
    request<{ user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  providers: () => request<{ providers: ProviderPublic[] }>('/api/providers'),
  createProvider: (input: ProviderInput) =>
    request<{ provider: ProviderPublic }>('/api/providers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateProvider: (id: string, patch: ProviderPatch) =>
    request<{ provider: ProviderPublic }>(`/api/providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteProvider: (id: string) =>
    request<void>(`/api/providers/${id}`, { method: 'DELETE' }),
  listProviderModels: (input: ProviderModelsInput) =>
    request<{ models: string[] }>('/api/providers/models', {
      method: 'POST',
      body: JSON.stringify(input),
      timeoutMs: 15_000,
    }),

  characters: () => request<{ characters: CharacterPublic[] }>('/api/characters'),
  createCharacter: (input: CharacterInput) =>
    request<{ character: CharacterPublic }>('/api/characters', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCharacter: (id: string, patch: CharacterPatch) =>
    request<{ character: CharacterPublic }>(`/api/characters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCharacter: (id: string) =>
    request<void>(`/api/characters/${id}`, { method: 'DELETE' }),

  chats: () => request<{ chats: ChatPublic[] }>('/api/chats'),
  createChat: (characterId: string) =>
    request<{ chat: ChatPublic; created: boolean }>('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),
  createGroupChat: (title: string, characterIds: string[]) =>
    request<{ chat: ChatPublic; created: boolean }>('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ kind: 'group', title, characterIds }),
    }),
  chat: (id: string) => request<{ chat: ChatPublic }>(`/api/chats/${id}`),
  updateChat: (id: string, input: ChatIdentityInput) =>
    request<{ chat: ChatPublic }>(`/api/chats/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  stickers: () => request<{ stickers: StickerPublic[] }>('/api/stickers'),
  addSticker: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ sticker: StickerPublic; stickers: StickerPublic[] }>('/api/stickers', {
      method: 'POST',
      body: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  },
  updateSticker: (url: string, desc: string) =>
    request<{ stickers: StickerPublic[] }>('/api/stickers', {
      method: 'PATCH',
      body: JSON.stringify({ url, desc }),
    }),
  removeSticker: (url: string) =>
    request<{ stickers: StickerPublic[] }>(`/api/stickers?url=${encodeURIComponent(url)}`, {
      method: 'DELETE',
    }),
  settings: () => request<{ weatherCity: string }>('/api/settings'),
  updateSettings: (patch: { weatherCity?: string }) =>
    request<{ weatherCity: string }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  messages: (id: string, options: { limit?: number; before?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.before) params.set('before', String(options.before));
    const query = params.toString();
    return request<MessagePage>(`/api/chats/${id}/messages${query ? `?${query}` : ''}`);
  },
  markRead: (id: string) =>
    request<void>(`/api/chats/${id}/read`, { method: 'POST' }),
  deleteChat: (id: string) =>
    request<void>(`/api/chats/${id}`, { method: 'DELETE' }),
  editMessage: (id: string, content: string) =>
    request<{ message: MessagePublic }>(`/api/messages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  deleteMessage: (id: string) =>
    request<{ message: MessagePublic }>(`/api/messages/${id}`, { method: 'DELETE' }),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ url: string; mime: string }>('/api/uploads', {
      method: 'POST',
      body: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  },

  worldBooks: () => request<{ worldBooks: WorldBookPublic[] }>('/api/world-books'),
  createWorldBook: (input: WorldBookInput) =>
    request<{ worldBook: WorldBookPublic }>('/api/world-books', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateWorldBook: (id: string, patch: WorldBookPatch) =>
    request<{ worldBook: WorldBookPublic }>(`/api/world-books/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteWorldBook: (id: string) =>
    request<void>(`/api/world-books/${id}`, { method: 'DELETE' }),
  createWorldBookEntry: (bookId: string, input: WorldBookEntryInput) =>
    request<{ entry: WorldBookEntryPublic }>(`/api/world-books/${bookId}/entries`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateWorldBookEntry: (bookId: string, entryId: string, patch: WorldBookEntryPatch) =>
    request<{ entry: WorldBookEntryPublic }>(
      `/api/world-books/${bookId}/entries/${entryId}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),
  deleteWorldBookEntry: (bookId: string, entryId: string) =>
    request<void>(`/api/world-books/${bookId}/entries/${entryId}`, { method: 'DELETE' }),

  memory: (chatId: string) =>
    request<{ memory: MemoryPublic }>(`/api/chats/${chatId}/memory`),
  refreshMemory: (chatId: string) =>
    request<{ memory: MemoryPublic }>(`/api/chats/${chatId}/memory/refresh`, {
      method: 'POST',
    }),
  updateSummary: (chatId: string, summary: string) =>
    request<{ summary: MemoryPublic['summary'] }>(`/api/chats/${chatId}/memory`, {
      method: 'PATCH',
      body: JSON.stringify({ summary }),
    }),
  createFact: (chatId: string, input: FactInput) =>
    request<{ fact: FactPublic }>(`/api/chats/${chatId}/facts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateFact: (id: string, patch: FactPatch) =>
    request<{ fact: FactPublic }>(`/api/facts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteFact: (id: string) => request<void>(`/api/facts/${id}`, { method: 'DELETE' }),

  schedule: (characterId: string, date?: string) => {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return request<{ plan: DayPlanPublic | null }>(`/api/characters/${characterId}/plan${query}`);
  },
  refreshPlan: (characterId: string) =>
    request<{ plan: DayPlanPublic }>(`/api/characters/${characterId}/plan/refresh`, {
      method: 'POST',
    }),
  testProactive: (characterId: string) =>
    request<{ message: MessagePublic }>(`/api/characters/${characterId}/proactive/test`, {
      method: 'POST',
    }),
  skipBeat: (characterId: string, beatId: string) =>
    request<void>(`/api/characters/${characterId}/beats/${beatId}/skip`, {
      method: 'POST',
    }),

  moments: (options: { limit?: number; before?: number; characterId?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.before) params.set('before', String(options.before));
    if (options.characterId) params.set('characterId', options.characterId);
    const query = params.toString();
    return request<{ moments: MomentPublic[] }>(`/api/moments${query ? `?${query}` : ''}`);
  },
  createMoment: (input: MomentInput) =>
    request<{ moment: MomentPublic }>('/api/moments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteMoment: (id: string) => request<void>(`/api/moments/${id}`, { method: 'DELETE' }),
  likeMoment: (id: string) =>
    request<{ liked: boolean; likeCount: number }>(`/api/moments/${id}/like`, {
      method: 'POST',
    }),
  commentMoment: (id: string, input: MomentCommentInput) =>
    request<{ comment: MomentCommentPublic }>(`/api/moments/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  musicTracks: () => request<{ tracks: MusicTrack[] }>('/api/music/tracks'),
  uploadMusic: (form: FormData) =>
    request<{ track: MusicTrack }>('/api/music/tracks', {
      method: 'POST',
      body: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }),
  neteaseSearch: (q: string) =>
    request<{ tracks: MusicTrack[] }>(`/api/music/netease/search?q=${encodeURIComponent(q)}`),
  neteaseDaily: () => request<{ tracks: MusicTrack[] }>('/api/music/netease/daily'),
  neteasePlaylist: (id: string) =>
    request<{ tracks: MusicTrack[] }>(`/api/music/netease/playlist/${encodeURIComponent(id)}`),
  neteaseLyrics: (id: string) =>
    request<{ lyrics: string }>(`/api/music/netease/lyrics/${id}`),
  musicSession: () => request<{ session: MusicSession }>('/api/music/session'),
  saveMusicSession: (session: Partial<MusicSession>) =>
    request<{ session: MusicSession }>('/api/music/session', {
      method: 'PATCH',
      body: JSON.stringify(session),
    }),
  musicComments: (trackId: string) =>
    request<{ comments: MusicCommentPublic[] }>(
      `/api/music/comments?trackId=${encodeURIComponent(trackId)}`,
    ),
  musicFavorites: () => request<{ tracks: MusicTrack[] }>('/api/music/favorites'),
  toggleMusicFavorite: (track: MusicTrack) =>
    request<{ favorited: boolean }>('/api/music/favorites', {
      method: 'POST',
      body: JSON.stringify({ track }),
    }),
  musicComment: (input: MusicCommentInput) =>
    request<{ comment: MusicCommentPublic }>('/api/music/comments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  pickTrack: (characterId: string) =>
    request<{ track: MusicTrack; character: unknown }>('/api/music/pick', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  pushKey: () => request<{ publicKey: string }>('/api/push/key'),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    request<{ ok: boolean }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
  unsubscribePush: (endpoint: string) =>
    request<{ ok: boolean }>('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),
  testPush: () => request<{ sent: number }>('/api/push/test', { method: 'POST' }),
  backupList: () =>
    request<{ backups: Array<{ name: string; size: number; createdAt: number }> }>(
      '/api/backup/list',
    ),
  importBackup: (form: FormData) =>
    request<{ imported: boolean; media: number }>('/api/backup/import', {
      method: 'POST',
      body: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }),
};
