// 石門國小電腦財產盤點系統 - 設定
// API Keys 可以直接改這裡，或在介面輸入後會自動存到 localStorage
window.SMES_CONFIG = {
  SUPABASE_URL: 'https://xcnmmaayrtiklntvhdhc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_nDPdupsm5wZI20iddtf12w_iV82XILn',
  STORAGE_BUCKET: 'inventory-photos',
  GEMINI_MODEL: 'gemini-3.1-flash-lite',
  // Gemini API Key 留空，會在首次使用時彈出輸入框存到本機
  GEMINI_API_KEY: '',
  // 電腦財產報廢點收：GAS Web App（試算表「石門國小 電腦財產報廢點收」，學校帳號擁有）
  // 後端會驗證 Supabase 登入 token，只接受學校網域帳號，網址本身不是密碼
  SCRAP_GAS_URL: 'https://script.google.com/macros/s/AKfycbxOql4FanopwENEisuw2gLOyX12a-6qAvAiQsjlHTRKi1BU6moIMV9PILSUD9uzFMbl-w/exec',
  SCHOOL_NAME: '桃園市石門國小',
  SCHOOL_YEAR: 114
};
