const EN_ADJ = [
  "Magenta", "Sepia", "Teal", "Ochre", "Cobalt", "Saffron", "Vermilion", "Mauve", "Chartreuse",
  "Umber", "Cerulean", "Amber", "Indigo", "Coral", "Olive", "Turquoise", "Crimson", "Lilac",
];
const EN_NOUN = [
  "Otter", "Raccoon", "Heron", "Lynx", "Wombat", "Yak", "Gecko", "Narwhal", "Llama", "Capybara",
  "Badger", "Axolotl", "Moose", "Pangolin", "Puffin", "Tapir", "Hedgehog", "Lemur",
];
// adjective agrees with the noun, so whole names
const RU = [
  "Бирюзовый Енот", "Пурпурная Выдра", "Охристый Ёж", "Лазурный Хомяк", "Шафрановый Як",
  "Терракотовая Альпака", "Сиреневый Кит", "Изумрудная Капибара", "Янтарный Барсук",
  "Малиновый Пингвин", "Оливковый Лемур", "Кобальтовый Тапир", "Коралловая Сова",
  "Индиговый Лось", "Горчичный Тушканчик", "Карминовый Геккон", "Сепиевый Нарвал",
  "Лавандовая Ламинария", "Мандариновый Тюлень", "Фисташковая Панда",
];

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

export function funnyName(lang: "en" | "ru", avoid?: string): string {
  for (;;) {
    const name = lang === "ru" ? pick(RU) : `${pick(EN_ADJ)} ${pick(EN_NOUN)}`;
    if (name !== avoid) return name;
  }
}
