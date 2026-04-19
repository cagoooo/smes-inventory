// Supabase REST client — 直接用 fetch，若已登入會帶使用者的 access_token
(function() {
  const C = window.SMES_CONFIG;

  function getHeaders() {
    // 優先用使用者的 access_token；沒登入則用 anon key
    const userToken = window.SMES_AUTH?.getAccessToken?.();
    return {
      apikey: C.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${userToken || C.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    };
  }

  async function rest(path, opts = {}) {
    const url = `${C.SUPABASE_URL}/rest/v1/${path}`;
    const res = await fetch(url, {
      ...opts,
      headers: { ...getHeaders(), ...(opts.headers || {}) }
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Supabase 錯誤: ${res.status} ${errText}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function uploadPhoto(file, path) {
    const url = `${C.SUPABASE_URL}/storage/v1/object/${C.STORAGE_BUCKET}/${path}`;
    const userToken = window.SMES_AUTH?.getAccessToken?.();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: C.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${userToken || C.SUPABASE_ANON_KEY}`,
        'Content-Type': file.type || 'image/jpeg',
        'x-upsert': 'true'
      },
      body: file
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`上傳失敗: ${res.status} ${err}`);
    }
    return publicUrl(path);
  }

  function publicUrl(path) {
    return `${C.SUPABASE_URL}/storage/v1/object/public/${C.STORAGE_BUCKET}/${path}`;
  }

  async function deletePhotoFile(path) {
    const url = `${C.SUPABASE_URL}/storage/v1/object/${C.STORAGE_BUCKET}/${path}`;
    const userToken = window.SMES_AUTH?.getAccessToken?.();
    await fetch(url, {
      method: 'DELETE',
      headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken || C.SUPABASE_ANON_KEY}` }
    });
  }

  window.SMES_DB = {
    // 教室
    async listClassrooms() {
      return rest('classrooms?select=*&order=floor,code');
    },
    async getClassroom(code) {
      const rows = await rest(`classrooms?code=eq.${encodeURIComponent(code)}&select=*`);
      return rows[0];
    },

    // 財產
    async listInventoryByRoom(code) {
      return rest(`inventory_items?classroom_code=eq.${encodeURIComponent(code)}&select=*&order=property_number`);
    },
    async listInventory(limit = 200) {
      return rest(`inventory_items?select=*&order=id&limit=${limit}`);
    },
    async searchInventory(kw) {
      const q = encodeURIComponent(`*${kw}*`);
      return rest(`inventory_items?or=(property_number.ilike.${q},model.ilike.${q},brand.ilike.${q},item_name.ilike.${q})&select=*&limit=20`);
    },
    async findInventoryByPropertyNumber(pn) {
      const q = encodeURIComponent(`*${pn}*`);
      return rest(`inventory_items?property_number.ilike=${q}&select=*`);
    },
    async insertInventoryBatch(items) {
      return rest('inventory_items', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(items)
      });
    },
    async clearInventory() {
      return rest('inventory_items?id=gte.0', { method: 'DELETE' });
    },
    async updateInventoryItem(id, patch) {
      return rest(`inventory_items?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      });
    },
    async insertInventoryItem(item) {
      const rows = await rest('inventory_items', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(item)
      });
      return rows[0];
    },

    // 照片紀錄
    async listPhotosByRoom(code, limit = 50) {
      return rest(`photo_records?classroom_code=eq.${encodeURIComponent(code)}&select=*&order=created_at.desc&limit=${limit}`);
    },
    async listAllPhotos(limit = 500) {
      return rest(`photo_records?select=*&order=created_at.desc&limit=${limit}`);
    },
    async insertPhoto(record) {
      const rows = await rest('photo_records', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(record)
      });
      return rows[0];
    },
    async updatePhoto(id, patch) {
      return rest(`photo_records?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      });
    },
    async deletePhoto(id) {
      return rest(`photo_records?id=eq.${id}`, { method: 'DELETE' });
    },

    // 統計
    async getClassroomStats() {
      return rest('classroom_stats?select=*&order=floor,code');
    },

    // 網路設備
    async listNetworkDevices() {
      return rest('network_devices?select=*&order=network_segment,classroom_code&limit=1000');
    },

    // 觸屏顯示器
    async listTouchscreens() {
      return rest('touchscreens?select=*&order=acquired_year.desc,property_number&limit=500');
    },

    // Storage
    uploadPhoto,
    publicUrl,
    deletePhotoFile
  };
})();
