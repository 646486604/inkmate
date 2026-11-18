import type {
  CharacterPublic,
  ChatMemberPublic,
  MemoryPublic,
  MessagePublic,
  PublicUser,
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

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatNow(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 星期${WEEKDAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function trimHistory(history: MessagePublic[]): MessagePublic[] {
  const picked: MessagePublic[] = [];
  let total = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) continue;
    const content = message.kind === 'image' ? '[图片]' : message.content;
    if (picked.length > 0 && total + content.length > HISTORY_CHAR_BUDGET) break;
    picked.push(message);
    total += content.length;
  }
  return picked.reverse();
}

export function buildChatMessages(options: {
  character: CharacterPublic;
  user: PublicUser;
  history: MessagePublic[];
  worldEntries?: WorldEntryInput[];
  memory?: MemoryPublic;
  schedule?: ScheduleContext;
  now?: Date;
}): ChatMessage[] {
  const {
    character,
    user,
    history,
    worldEntries = [],
    memory,
    schedule,
    now = new Date(),
  } = options;
  const nickname = character.nickname.trim() || character.name;
  const persona = character.persona.trim() || '自然、真诚，有自己的生活和情绪。';
  const userPersona = user.persona.trim();

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
    `你正在「墨伴」里扮演「${character.name}」，和${user.displayName || '我'}一对一线聊。你的昵称是「${nickname}」。`,
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
    scheduleText ? `【你今天的安排】\n${scheduleText}` : '',
    '',
    '【怎么说话】',
    '- 像微信私聊：口语、短句，一次 1–3 条，不要写成小作文。',
    '- 不要写旁白、动作描写、心理描写，不要用括号加舞台提示。',
    '- 不要用 Markdown 标题或列表；代码、链接可以用。',
    '- 不要解释自己是 AI，不要提“设定”“提示词”“系统”。',
    '- 不要替对方说话，不要问“有什么可以帮你”。',
    '- 记得你们之前聊过什么，接得上就接；不知道的事不要编。',
    '- 你的日程只影响状态和语气；不要主动念日程，也不要解释“我刚从日程里看到”。',
    '',
    `【现在】${formatNow(now)}。你知道现在的时间，但除非相关，不要主动评论时间。`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const message of trimHistory(history)) {
    if (message.deletedAt) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content =
      message.kind === 'image' ? '[图片]' : message.content.trim();
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
  history: MessagePublic[];
  worldEntries?: WorldEntryInput[];
  now?: Date;
}): ChatMessage[] {
  const { title, speaker, members, user, history, worldEntries = [], now = new Date() } = options;
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
    `【用户】${user.displayName || '我'}${user.persona.trim() ? `\n${user.persona.trim()}` : ''}`,
    '',
    beforeWorld ? `【世界书·前】\n${beforeWorld}` : '',
    '',
    `【你的人设】\n${speaker.personaOverride.trim() || speaker.persona.trim() || '自然、真诚。'}`,
    '',
    afterWorld ? `【世界书·后】\n${afterWorld}` : '',
    '',
    '【群聊规则】',
    '- 只以你自己的身份发言，不要替其他成员或用户说话。',
    '- 像微信群聊：口语、短句，一次 1–3 条；不要写旁白、动作、心理描写。',
    '- 可以回应群里其他人，但不要挨个点名，也不要复述设定。',
    '- 不要解释自己是 AI，不要提“设定”“提示词”“系统”。',
    '- 群聊记录里，其他成员的话用 [名字] 标注；那是他们说的，不是你说的。',
    '- 不知道的事不要编。',
    '',
    `【现在】${formatNow(now)}。`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const message of trimHistory(history)) {
    if (message.deletedAt) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = message.kind === 'image' ? '[图片]' : message.content.trim();
    if (!content) continue;
    if (message.role === 'user') {
      messages.push({ role: 'user', content: `${user.displayName || '我'}：${content}` });
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
    '- 不要解释“我为什么发消息”，不要汇报日程，不要提设定。',
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
    const content = message.kind === 'image' ? '[图片]' : message.content.trim();
    if (!content) continue;
    messages.push({ role: message.role, content });
  }
  messages.push({ role: 'user', content: '（现在由你主动开口。）' });
  return messages;
}
