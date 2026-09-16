import type { KeyPerson } from '@/lib/types/people';

/**
 * Real-world identity registry for tracked key people/institutions.
 * Verified against public sources as of 2026-09-11 (see NEWS-PEOPLE.md for citations).
 * This file is the single place to update when someone changes role — everything
 * else (peopleService, PersonCard, real-news person matching) reads from here.
 *
 * `personEvents`/`dayTimeline` in lib/mock/people.ts remain fictional placeholder
 * content until GPT-based event extraction (Phase 2B) ships; only identity fields
 * here (name/title/organization/aliases) are real.
 *
 * tw-executive / tw-regulator are intentionally left as unresolved generic
 * placeholders (aliases: []) — real named individuals were not in scope for this pass.
 */
export const peopleRegistry: (Omit<KeyPerson, 'currentImpactLevel' | 'aliases'> & { aliases: string[] })[] = [
  { id: 'donald-trump', name: '川普', title: '美國總統', organization: '美國政府', category: 'us_politics', relatedSymbols: ['2330', '0050', 'AAPL'], aliases: ['Trump', 'Donald Trump', '川普', '特朗普'] },
  { id: 'scott-bessent', name: '貝森特', title: '美國財政部長', organization: '美國財政部', category: 'us_politics', relatedSymbols: ['0050', '2330', 'VOO'], aliases: ['Bessent', 'Scott Bessent', '貝森特'] },
  { id: 'kevin-warsh', name: '華許', title: 'Fed 主席', organization: '美國聯準會', category: 'central_bank', relatedSymbols: ['QQQ', 'VOO', 'AAPL'], aliases: ['Kevin Warsh', 'Warsh', '華許', '沃許'] },
  { id: 'jerome-powell', name: '鮑爾', title: 'Fed 理事（前主席）', organization: '美國聯準會', category: 'central_bank', relatedSymbols: ['QQQ', 'VOO', 'AAPL'], aliases: ['Powell', 'Jerome Powell', '鮑爾', '包爾'] },
  { id: 'john-williams', name: '威廉斯', title: '紐約聯邦準備銀行總裁・FOMC 副主席', organization: '紐約聯邦準備銀行', category: 'central_bank', relatedSymbols: ['QQQ', 'VOO'], aliases: ['John Williams', 'John C. Williams', '威廉斯'] },
  { id: 'jensen-huang', name: '黃仁勳', title: 'NVIDIA 執行長', organization: 'NVIDIA', category: 'corporate_leader', relatedSymbols: ['NVDA', '2330', '0050'], aliases: ['Jensen Huang', '黃仁勳'] },
  { id: 'tim-cook', name: '庫克', title: 'Apple 執行長', organization: 'Apple', category: 'corporate_leader', relatedSymbols: ['AAPL', '2317'], aliases: ['Tim Cook', '庫克'] },
  { id: 'cc-wei', name: '魏哲家', title: '台積電董事長暨總裁', organization: '台積電', category: 'corporate_leader', relatedSymbols: ['2330', '0050'], aliases: ['C.C. Wei', 'Wei', '魏哲家', 'TSMC'] },
  { id: 'elon-musk', name: '馬斯克', title: 'Tesla 執行長（兼 SpaceX、xAI）', organization: 'Tesla', category: 'corporate_leader', relatedSymbols: [], aliases: ['Elon Musk', 'Musk', '馬斯克'] },
  { id: 'sam-altman', name: '阿特曼', title: 'OpenAI 執行長', organization: 'OpenAI', category: 'corporate_leader', relatedSymbols: [], aliases: ['Sam Altman', 'Altman', '阿特曼'] },
  { id: 'lisa-su', name: '蘇姿丰', title: 'AMD 董事長暨執行長', organization: 'AMD', category: 'corporate_leader', relatedSymbols: [], aliases: ['Lisa Su', '蘇姿丰', 'AMD'] },
  { id: 'yang-chin-long', name: '楊金龍', title: '中央銀行總裁', organization: '中華民國中央銀行', category: 'tw_politics', relatedSymbols: ['0050'], aliases: ['楊金龍', 'Yang Chin-long'] },
  { id: 'tw-executive', name: '行政院發言代表', title: '政策發言窗口（人選待確認）', organization: '台灣行政院', category: 'tw_politics', relatedSymbols: ['0050', '2317'], aliases: [] },
  { id: 'tw-regulator', name: '金管會代表', title: '金融監理窗口（人選待確認）', organization: '台灣金融監理', category: 'regulator', relatedSymbols: ['0050'], aliases: [] },
];
