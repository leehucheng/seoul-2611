// Place categories. `icon` is an SVG <symbol> id; icons are drawn white on `color`,
// so every color keeps >= 3:1 contrast against #FFFFFF (checked in tests/links-match.test.mjs).
export const CATEGORIES = [
  { id: 'bbq', label: '烤肉', color: '#C62828', icon: 'i-flame' },
  { id: 'korean', label: '韓食/麵食', color: '#E65100', icon: 'i-bowl' },
  { id: 'seafood', label: '海鮮/醬蟹', color: '#0277BD', icon: 'i-fish' },
  { id: 'dessert', label: '甜點', color: '#D81B60', icon: 'i-cake' },
  { id: 'cafe', label: '咖啡廳', color: '#795548', icon: 'i-coffee' },
  { id: 'bar', label: '酒吧/夜店', color: '#4A148C', icon: 'i-glass' },
  { id: 'fashion', label: '衣服', color: '#00838F', icon: 'i-shirt' },
  { id: 'beauty', label: '美妝/香水', color: '#9C27B0', icon: 'i-perfume' },
  { id: 'art', label: '展覽/美術館', color: '#827717', icon: 'i-frame' },
  { id: 'sight', label: '景點/銀杏', color: '#2E7D32', icon: 'i-leaf' },
  { id: 'night', label: '夜景/日落', color: '#1B2F5E', icon: 'i-moon' },
  { id: 'hotel', label: '住宿', color: '#546E7A', icon: 'i-bed' },
];
