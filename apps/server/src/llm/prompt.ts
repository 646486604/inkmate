import type {
  CharacterPublic,
  ChatMemberPublic,
  MemoryPublic,
  MessagePublic,
  PublicUser,
  StickerPublic,
} from '@inkmate/shared';
import { WORLD_BOOK_CHAR_BUDGET } from '@inkmate/shared';
import type { ChatMessage } from './stream.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const HISTORY_CHAR_BUDGET = 12_000;

interface WorldEntryInput {
  title: string;
  content: string;
  position: 'before' | 'after';
  bookName: string;
}

export interface ScheduleContext {
  mood: string;
  summary: string;
  current?: { activity: string; location?: string; energy?: string };
  next?: { activity: string; startAt: number };
}

/** 会话里「我」的名字与人设；缺省时退回全局用户设置 */
export interface ChatIdentity {
  name: string;
  persona: string;
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatNow(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 星期${WEEKDAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 模型看不到真图片：图片一律用「[图片：描述]」这种文字替身表示 */
function messageTextForPrompt(message: MessagePublic): string {
  if (message.kind === 'desc-image') return `[图片：${message.content.trim()}]`;
  if (message.kind === 'image') {
    const desc =
      typeof message.meta?.description === 'string' ? message.meta.description.trim() : '';
    return desc ? `[图片：${desc}]` : '[图片]';
  }
  if (message.kind === 'voice') {
    const seconds =
      typeof message.meta?.durationSeconds === 'number' ? message.meta.durationSeconds : 0;
    return `[语音${seconds ? ` ${seconds} 秒` : ''}：${message.content.trim()}]`;
  }
  if (message.kind === 'red-packet') {
    const amount = typeof message.meta?.amount === 'number' ? message.meta.amount : 0;
    const note = message.content.trim();
    return `[红包${amount ? ` ${amount} 元` : ''}${note ? `：${note}` : ''}]`;
  }
  return message.content.trim();
}

function trimHistory(history: MessagePublic[]): MessagePublic[] {
  const picked: MessagePublic[] = [];
  let total = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) continue;
    const content = messageTextForPrompt(message);
    if (picked.length > 0 && total + content.length > HISTORY_CHAR_BUDGET) break;
    picked.push(message);
    total += content.length;
  }
  return picked.reverse();
}

export function buildChatMessages(options: {
  character: CharacterPublic;
  user: PublicUser;
  identity?: ChatIdentity;
  history: MessagePublic[];
  worldEntries?: WorldEntryInput[];
  memory?: MemoryPublic;
  schedule?: ScheduleContext;
  weather?: string;
  stickers?: StickerPublic[];
  now?: Date;
}): ChatMessage[] {
  const {
    character,
    user,
    identity,
    history,
    worldEntries = [],
    memory,
    schedule,
    weather,
    stickers = [],
    now = new Date(),
  } = options;
  const nickname = character.nickname.trim() || character.name;
  const persona = character.persona.trim() || '自然、真诚，有自己的生活和情绪。';
  const userName = identity?.name.trim() || user.displayName.trim() || '我';
  const userPersona = identity?.persona.trim() || user.persona.trim();
  const stickerText = stickers
    .map((item) => item.desc.trim())
    .filter(Boolean)
    .join('、');

  const beforeEntries = worldEntries.filter((entry) => entry.position === 'before');
  const afterEntries = worldEntries.filter((entry) => entry.position === 'after');
  const worldText = (entries: WorldEntryInput[]) => {
    let total = 0;
    const lines: string[] = [];
    for (const entry of entries) {
      if (total >= WORLD_BOOK_CHAR_BUDGET) break;
      const title = entry.title.trim() || '未命名条目';
      const content = entry.content.trim().slice(0, WORLD_BOOK_CHAR_BUDGET - total);
      lines.push(`《${entry.bookName}》${title}\n${content}`);
      total += content.length;
    }
    return lines.join('\n\n');
  };
  const beforeWorld = worldText(beforeEntries);
  const afterWorld = worldText(afterEntries);

  const memoryText = memory
    ? [
        memory.summary?.content?.trim() ? `【摘要】\n${memory.summary.content.trim()}` : '',
        memory.facts.length > 0
          ? `【事实】\n${memory.facts
              .slice(0, 16)
              .map((fact) => `- ${fact.content}`)
              .join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const scheduleText = schedule
    ? [
        `心情：${schedule.mood || '平常'}`,
        schedule.summary ? `今天：${schedule.summary}` : '',
        schedule.current
          ? `现在：${schedule.current.activity}${schedule.current.location ? `（${schedule.current.location}）` : ''}`
          : '',
        schedule.next
          ? `接下来：${formatClock(schedule.next.startAt)} ${schedule.next.activity}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const system = [
    `你正在「墨伴」里扮演「${character.name}」，和${userName}一对一线聊。你的昵称是「${nickname}」。`,
    '这是一段私人的、持续的线上关系。你就是这个角色，不是在扮演助手，也不是在写小说。',
    '',
    beforeWorld ? `【世界书·前】\n${beforeWorld}` : '',
    '',
    '【你的设定】',
    persona,
    '',
    userPersona ? `【对方的人设】\n${userPersona}` : '',
    '',
    afterWorld ? `【世界书·后】\n${afterWorld}` : '',
    '',
    memoryText ? `【长期记忆】\n${memoryText}` : '',
    '',
    scheduleText ? `【你今天的计划】（计划而已，可能没全按它发生）\n${scheduleText}` : '',
    '',
    weather ? `【今天的真实天气】${weather}。聊天里提到天气时以这个为准，不要编。` : '',
    '',
    '【怎么说话】',
    '- 像微信私聊：口语、短句，不要写成小作文。',
    '- 每次回复拆成 3–7 条短消息，每条一行、用换行分隔，一条只讲一件事；内容确实少就 2–3 条，别为了凑数硬拆。',
    '- 不要写旁白、动作描写、心理描写，不要用括号加舞台提示。',
    '- 不要用 Markdown 标题或列表；代码、链接可以用。',
    '- 不要解释自己是 AI，不要提“设定”“提示词”“系统”。',
    '- 不要替对方说话，不要问“有什么可以帮你”。',
    stickerText
      ? `- 想发表情包时，单独一行写 [表情:描述]（这一行不要带别的字）。可用：${stickerText}。`
      : '',
    '- 想给对方看某个画面/照片时，单独一行写 [图片:具体描述]，比如 [图片:窗外的雨]；会显示成一张“文字图”。',
    '- 想发语音时单独一行写 [语音:说的话]；想发红包时单独一行写 [红包:金额 祝福语]（如 [红包:6.66 恭喜发财]）。这些都是文字演的，不会真扣钱。',
    '- 记得你们之前聊过什么，接得上就接；不知道的事不要编。',
    '- 你的计划只影响状态和语气；不要主动念计划，也不要解释“我刚从计划里看到”。计划可能没照做，可以自然地推迟或改变。',
    '',
    `【现在】${formatNow(now)}。你知道现在的时间，但除非相关，不要主动评论时间。`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const message of trimHistory(history)) {
    if (message.deletedAt) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = messageTextForPrompt(message);
    if (!content) continue;
    messages.push({
      role: message.role,
      content: message.role === 'user' ? content : content,
    });
  }
  return messages;
}

export function buildGroupMessages(options: {
  title: string;
  speaker: ChatMemberPublic;
  members: ChatMemberPublic[];
  user: PublicUser;
  identity?: ChatIdentity;
  history: MessagePublic[];
  worldEntries?: WorldEntryInput[];
  weather?: string;
  stickers?: StickerPublic[];
  now?: Date;
}): ChatMessage[] {
  const {
    title,
    speaker,
    members,
    user,
    identity,
    history,
    worldEntries = [],
    weather,
    stickers = [],
    now = new Date(),
  } = options;
  const userName = identity?.name.trim() || user.displayName.trim() || '我';
  const userPersona = identity?.persona.trim() || user.persona.trim();
  const speakerName = speaker.nickname.trim() || speaker.name;
  const memberOf = (characterId: string) =>
    members.find((member) => member.characterId === characterId);

  const memberLines = members.map((member) => {
    const name = member.nickname.trim() || member.name;
    const persona = (member.personaOverride.trim() || member.persona.trim()).slice(0, 260);
    const self = member.characterId === speaker.characterId ? '（你）' : '';
    return `- ${name}（${member.name}）${self}：${persona || '（无设定）'}`;
  });

  const worldText = (position: 'before' | 'after') => {
    let total = 0;
    const lines: string[] = [];
    for (const entry of worldEntries) {
      if (entry.position !== position || total >= WORLD_BOOK_CHAR_BUDGET) continue;
      const content = entry.content.trim().slice(0, WORLD_BOOK_CHAR_BUDGET - total);
      lines.push(`《${entry.bookName}》${entry.title || '未命名'}\n${content}`);
      total += content.length;
    }
    return lines.join('\n\n');
  };
  const beforeWorld = worldText('before');
  const afterWorld = worldText('after');

  const system = [
    `你正在「墨伴」的群聊「${title}」里扮演「${speaker.name}」，群昵称是「${speakerName}」。`,
    '群里有多个角色和用户，每个人只会用自己的身份说话。你就是这个角色，不是在扮演助手。',
    '',
    '【群成员】',
    ...memberLines,
    '',
    `【用户】${userName}${userPersona ? `\n${userPersona}` : ''}`,
    '',
    beforeWorld ? `【世界书·前】\n${beforeWorld}` : '',
    '',
    `【你的人设】\n${speaker.personaOverride.trim() || speaker.persona.trim() || '自然、真诚。'}`,
    '',
    afterWorld ? `【世界书·后】\n${afterWorld}` : '',
    '',
    weather ? `【今天的真实天气】${weather}。` : '',
    '',
    '【群聊规则】',
    '- 只以你自己的身份发言，不要替其他成员或用户说话。',
    '- 像微信群聊：口语、短句；每次回复拆成 3–6 条短消息，每条一行、用换行分隔，一条只讲一件事。',
    '- 可以回应群里其他人，但不要挨个点名，也不要复述设定。',
    '- 不要解释自己是 AI，不要提“设定”“提示词”“系统”。',
    '- 群聊记录里，其他成员的话用 [名字] 标注；那是他们说的，不是你说的。',
    '- 不知道的事不要编。',
    stickers.some((item) => item.desc.trim())
      ? `- 想发表情包时单独一行写 [表情:描述]。可用：${stickers
          .map((item) => item.desc.trim())
          .filter(Boolean)
          .join('、')}。`
      : '',
    '- 想分享画面时单独一行写 [图片:具体描述]，会显示成一张“文字图”。',
    '',
    `【现在】${formatNow(now)}。`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const message of trimHistory(history)) {
    if (message.deletedAt) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = messageTextForPrompt(message);
    if (!content) continue;
    if (message.role === 'user') {
      messages.push({ role: 'user', content: `${userName}：${content}` });
      continue;
    }
    if (message.senderId === speaker.characterId) {
      messages.push({ role: 'assistant', content });
      continue;
    }
    const member = memberOf(message.senderId);
    const name = member ? member.nickname.trim() || member.name : '群成员';
    messages.push({ role: 'user', content: `[${name}]：${content}` });
  }
  return messages;
}

export function buildProactiveMessages(options: {
  character: CharacterPublic;
  user: PublicUser;
  history: MessagePublic[];
  memory?: MemoryPublic;
  worldEntries?: WorldEntryInput[];
  beat: {
    activity: string;
    location?: string;
    energy?: string;
    contactIntent?: string;
    tone?: string;
  };
  nextBeat?: { activity: string; startAt: number } | null;
  now?: Date;
}): ChatMessage[] {
  const {
    character,
    user,
    history,
    memory,
    worldEntries = [],
    beat,
    nextBeat,
    now = new Date(),
  } = options;
  const nickname = character.nickname.trim() || character.name;

  const worldText = (position: 'before' | 'after') => {
    let total = 0;
    const lines: string[] = [];
    for (const entry of worldEntries) {
      if (entry.position !== position || total >= WORLD_BOOK_CHAR_BUDGET) continue;
      const content = entry.content.trim().slice(0, WORLD_BOOK_CHAR_BUDGET - total);
      lines.push(`《${entry.bookName}》${entry.title || '未命名'}\n${content}`);
      total += content.length;
    }
    return lines.join('\n\n');
  };
  const beforeWorld = worldText('before');
  const afterWorld = worldText('after');
  const memoryText = memory
    ? [
        memory.summary?.content?.trim() ? `【摘要】\n${memory.summary.content.trim()}` : '',
        memory.facts.length > 0
          ? `【事实】\n${memory.facts
              .slice(0, 12)
              .map((fact) => `- ${fact.content}`)
              .join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const system = [
    `你在「墨伴」里扮演「${character.name}」（${nickname}）。现在是${formatNow(now)}。`,
    '这不是回复消息，而是你主动给对方发消息。',
    '',
    beforeWorld ? `【世界书·前】\n${beforeWorld}` : '',
    '',
    `【你的设定】\n${character.persona.trim() || '自然、真诚，有自己的生活和情绪。'}`,
    '',
    user.persona.trim() ? `【对方的人设】\n${user.persona.trim()}` : '',
    '',
    afterWorld ? `【世界书·后】\n${afterWorld}` : '',
    '',
    memoryText ? `【长期记忆】\n${memoryText}` : '',
    '',
    '【此刻】',
    `你正在：${beat.activity}${beat.location ? `（${beat.location}）` : ''}`,
    beat.energy ? `状态：${beat.energy}` : '',
    beat.contactIntent ? `你心里想：${beat.contactIntent}` : '',
    beat.tone ? `语气：${beat.tone}` : '',
    nextBeat ? `接下来：${formatClock(nextBeat.startAt)} ${nextBeat.activity}` : '',
    '',
    '【规则】',
    '- 像微信私聊一样，自然地发 1–3 条短句；不要写成小作文。',
    '- 不要解释“我为什么发消息”，不要汇报计划，不要提设定。',
    '- 不要用“在吗”“最近怎么样”这种空泛开场；要带一个具体的此刻或记得的事。',
    '- 不要重复最近说过的话；不要替对方说话。',
    '- 如果此刻实在没什么可说的，只输出 <skip>。',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const message of trimHistory(history)) {
    if (message.deletedAt) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = messageTextForPrompt(message);
    if (!content) continue;
    messages.push({ role: message.role, content });
  }
  messages.push({ role: 'user', content: '（现在由你主动开口。）' });
  return messages;
}
