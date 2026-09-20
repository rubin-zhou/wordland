'use strict';
// Item catalog + prices for the «我的家» decoration game. Currency: 火力 (streak).

const COLORS = ['orig', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];

// pos: [x%, y%] — x = 水平中心, y = 脚底基线 (wall:true 时 y = 中心点), 单位是场景的百分比
const ROOMS = [
  {
    id: 'kitchen', name: '厨房', icon: '🍽️',
    items: [
      { id: 'pot',      name: '小奶锅',  emoji: '🥘', cost: 2, pos: [24, 46] },
      { id: 'kettle',   name: '烧水壶',  emoji: '🫖', cost: 2, pos: [13, 46] },
      { id: 'stove',    name: '灶台',    emoji: '🍳', cost: 3, pos: [37, 46] },
      { id: 'cooker',   name: '电饭锅',  emoji: '🍚', cost: 3, pos: [50, 46] },
      { id: 'fridge',   name: '冰箱',    emoji: '🧊', cost: 4, pos: [88, 50], big: true },
      { id: 'oven',     name: '烤箱',    emoji: '🥧', cost: 5, pos: [63, 46] },
    ],
  },
  {
    id: 'living', name: '客厅', icon: '🛋️',
    items: [
      { id: 'plant',    name: '绿植',    emoji: '🪴', cost: 2, pos: [13, 58] },
      { id: 'lamp',     name: '台灯',    emoji: '💡', cost: 2, pos: [88, 54], anim: 'glow' },
      { id: 'sofa',     name: '大沙发',  emoji: '🛋️', cost: 4, pos: [50, 86], big: true },
      { id: 'tv',       name: '电视',    emoji: '📺', cost: 5, pos: [50, 44] },
      { id: 'cat',      name: '小猫',    emoji: '🐱', cost: 6, pos: [86, 80], anim: 'float' },
      { id: 'piano',    name: '钢琴',    emoji: '🎹', cost: 7, pos: [78, 54], big: true },
    ],
  },
  {
    id: 'bedroom', name: '卧室', icon: '🛏️',
    items: [
      { id: 'nightlight', name: '小夜灯', emoji: '🌙', cost: 1, pos: [50, 12], wall: true, anim: 'glow' },
      { id: 'clock',    name: '闹钟',    emoji: '⏰', cost: 2, pos: [57, 44] },
      { id: 'teddy',    name: '泰迪熊',  emoji: '🧸', cost: 3, pos: [36, 57] },
      { id: 'wardrobe', name: '衣柜',    emoji: '🚪', cost: 4, pos: [90, 46], big: true },
      { id: 'bed',      name: '大床',    emoji: '🛏️', cost: 5, pos: [35, 76], big: true },
    ],
  },
  {
    id: 'bathroom', name: '浴室', icon: '🛁',
    items: [
      { id: 'towel',    name: '毛巾',    emoji: '🧻', cost: 1, pos: [22, 13], wall: true },
      { id: 'basket',   name: '收纳筐',  emoji: '🧺', cost: 2, pos: [10, 78] },
      { id: 'mirror',   name: '圆镜子',  emoji: '🪞', cost: 3, pos: [42, 13], wall: true },
      { id: 'shower',   name: '花洒',    emoji: '🚿', cost: 3, pos: [78, 11], wall: true },
      { id: 'duck',     name: '小黄鸭',  emoji: '🦆', cost: 4, pos: [78, 86], anim: 'float' },
      { id: 'tub',      name: '浴缸',    emoji: '🛁', cost: 5, pos: [78, 52], big: true },
    ],
  },
  {
    id: 'study', name: '书房', icon: '📚',
    items: [
      { id: 'chair',    name: '小椅子',  emoji: '🪑', cost: 2, pos: [46, 66] },
      { id: 'globe',    name: '地球仪',  emoji: '🌍', cost: 3, pos: [89, 50] },
      { id: 'shelf',    name: '书架',    emoji: '📚', cost: 4, pos: [11, 46], big: true },
      { id: 'pc',       name: '电脑',    emoji: '💻', cost: 6, pos: [46, 42] },
      { id: 'scope',    name: '望远镜',  emoji: '🔭', cost: 7, pos: [58, 62] },
    ],
  },
  {
    id: 'garden', name: '花园', icon: '🌸',
    items: [
      { id: 'flower',   name: '小花',    emoji: '🌷', cost: 1, pos: [26, 40] },
      { id: 'tree',     name: '灌木丛',  emoji: '🌳', cost: 3, pos: [13, 46], big: true },
      { id: 'butterfly', name: '蝴蝶',   emoji: '🦋', cost: 3, pos: [68, 66], anim: 'flutter' },
      { id: 'carousel', name: '小木马',  emoji: '🎠', cost: 5, pos: [42, 64], big: true },
      { id: 'tent',     name: '帐篷',    emoji: '⛺', cost: 6, pos: [78, 48], big: true },
    ],
  },
];

function findItem(roomId, itemId) {
  const room = ROOMS.find((r) => r.id === roomId);
  if (!room) return null;
  const item = room.items.find((i) => i.id === itemId);
  return item ? { room, item } : null;
}

module.exports = { ROOMS, COLORS, findItem };
