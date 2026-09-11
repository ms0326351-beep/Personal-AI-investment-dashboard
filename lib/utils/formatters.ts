export const number = (value:number, digits=2) => new Intl.NumberFormat('zh-TW',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
export const percent = (value:number) => `${value>=0?'+':''}${number(value)}%`;
export const money = (value:number,currency='TWD') => `${currency==='TWD'?'NT$':'US$'} ${number(value, currency==='TWD'?0:2)}`;
