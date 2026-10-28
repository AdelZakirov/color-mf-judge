export type Lang = "en" | "ru";

const en = {
  brand: "true colors",
  title: "Which one looks real?",
  lead: "Each pair is one black-and-white photo, colorized two ways. Tap the one that looks like a real color photo.",
  rules: ["20 pairs, about two minutes", "No right answers: go with your first impression"],
  nameLabel: "What should we call you?",
  reroll: "Another name",
  start: "Start",
  resume: "Continue · {n} of {total}",
  note: "The page stays gray on purpose, so it doesn't tint what you see.",
  question: "Which looks more natural?",
  hintRow: "Tap a photo or press ← →",
  hintCol: "Tap a photo or press ↑ ↓",
  back: "Back",
  doneTitle: "Thank you, {name}.",
  doneLead: "Your choices are in. Every extra pair makes the comparison sharper.",
  statPairs: "pairs",
  statTime: "total",
  statMedian: "per choice",
  more: "20 more pairs",
  share: "Send to a friend",
  copied: "Link copied",
  saved: "All answers saved",
  saving: "Saving…",
  pending: "{n} answers waiting for a connection. Keep this tab open.",
  rejected: "{n} answers were not accepted by the server. Please tell whoever sent you the link.",
  loading: "Loading photos…",
};

const ru: typeof en = {
  brand: "true colors",
  title: "Какое фото настоящее?",
  lead: "В паре одно чёрно-белое фото, раскрашенное двумя способами. Выберите то, что похоже на настоящее цветное.",
  rules: ["20 пар, около двух минут", "Правильных ответов нет, выбирайте сходу"],
  nameLabel: "Как вас называть?",
  reroll: "Другое имя",
  start: "Начать",
  resume: "Продолжить · {n} из {total}",
  note: "Интерфейс нарочно серый, чтобы не влиять на восприятие цвета.",
  question: "Какое выглядит естественнее?",
  hintRow: "Нажмите на фото или ← →",
  hintCol: "Нажмите на фото или ↑ ↓",
  back: "Назад",
  doneTitle: "Спасибо, {name}!",
  doneLead: "Ответы записаны. Каждая лишняя пара делает сравнение точнее.",
  statPairs: "пар",
  statTime: "всего",
  statMedian: "на выбор",
  more: "Ещё 20 пар",
  share: "Отправить другу",
  copied: "Ссылка скопирована",
  saved: "Все ответы сохранены",
  saving: "Сохраняем…",
  pending: "Ответов ждут сеть: {n}. Не закрывайте вкладку.",
  rejected: "Сервер не принял ответов: {n}. Пожалуйста, сообщите тому, кто прислал ссылку.",
  loading: "Загружаем фото…",
};

export const strings = { en, ru };
export type Strings = typeof en;

export function fmt(s: string, vars: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
