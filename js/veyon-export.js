// Veyon JSON 匯出 + 差異比對
(function() {
  // 既有群組的 UID（與目前 Veyon 設定一致，避免覆蓋後群組被當新建）
  const GROUP_UIDS = {
    '109-SMES':   '{61859502-63d9-4682-bbbd-819bd8430eb9}',
    '113-SMES':   '{1c681869-07c4-4626-a0b8-5ec5e60aa8c6}',
    '移動觸屏':   '{c5defd6d-3764-48d4-ba5f-1b49b09aba09}',
    '@行政':      '{6af49467-9d55-4bda-94bc-38dd5f4f22a5}',
    '全校班級電腦': '{a1fc596c-83a9-4c7c-a194-8dd9be43897e}',
  };

  // 群組順序（影響 Veyon 介面上的顯示順序）
  const GROUP_ORDER = ['109-SMES', '113-SMES', '移動觸屏', '@行政', '全校班級電腦'];

  // Veyon 設定檔的固定部分（Authentication / Core / Network 等）
  const VEYON_BASE = {
    Authentication: { Method: 1 },
    Core: {
      ApplicationVersion: 8,
      InstallationID: '5a1e02be-3807-48ba-8c02-0c9137ca76f1',
      PluginVersions: {
        JsonStoreObject: {
          '{14bacaaa-ebe5-449c-b881-5b382f952571}': '1.1',
          '{1b08265b-348f-4978-acaa-45d4f6b90bd9}': '1.1',
          '{1baa01e0-02d6-4494-a766-788f5b225991}': '1.1',
          '{2917cdeb-ac13-4099-8715-20368254a367}': '1.1',
          '{2ad98ccb-e9a5-43ef-8c4c-876ac5efbcb1}': '1.1',
          '{387a0c43-1355-4ff6-9e1f-d098e9ce5127}': '1.1',
          '{39d7a07f-94db-4912-aa1a-c4df8aee3879}': '1.1',
          '{4122e8ca-b617-4e36-b851-8e050ed2d82e}': '1.2',
          '{4790bad8-4c56-40d5-8361-099a68f0c24b}': '1.1',
          '{67dfc1c1-8f37-4539-a298-16e74e34fd8b}': '1.1',
          '{6f0a491e-c1c6-4338-8244-f823b0bf8670}': '1.2',
          '{80580500-2e59-4297-9e35-e53959b028cd}': '1.2',
          '{8ae6668b-9c12-4b29-9bfc-ff89f6604164}': '1.1',
          '{a54ee018-42bf-4569-90c7-0d8470125ccf}': '2.0',
          '{d4bb9c42-9eef-4ecb-8dd5-dfd84b355481}': '1.0',
          '{e11bee03-b99c-465c-bf90-7e5339b83f6b}': '1.0',
          '{ee322521-f4fb-482d-b082-82a79003afa7}': '1.1',
          '{f626f759-7691-45c0-bd4a-37171d98d219}': '1.0'
        }
      }
    },
    LDAP: {
      ComputerLocationAttribute: '',
      ComputerLocationsByAttribute: 'false',
      ComputerLocationsByContainer: 'false',
      LocationNameAttribute: '',
      UserLoginNameAttribute: ''
    },
    Master: {
      AllowAddingHiddenLocations: 'false',
      AutoAdjustMonitoringIconSize: 'false',
      AutoOpenComputerSelectPanel: 'false',
      AutoSelectCurrentLocation: 'false',
      ConfirmUnsafeActions: 'false',
      HideComputerFilter: 'false',
      HideEmptyLocations: 'false',
      HideLocalComputer: 'false',
      ShowCurrentLocationOnly: 'false'
    },
    Network: {
      FirewallExceptionEnabled: '1',
      VeyonServerPort: 11100
    },
    Service: {
      SoftwareSASEnabled: '0'
    },
    Windows: {
      SoftwareSASEnabled: '1'
    }
  };

  function wrapUid(uid) {
    if (!uid) return null;
    if (uid.startsWith('{') && uid.endsWith('}')) return uid;
    return `{${uid}}`;
  }

  // ============ 核心：從資料庫 devices 陣列組出 Veyon JSON ============
  function build(devices) {
    const arr = [];

    // 1. 收集有出現的群組
    const groupsInUse = new Set();
    devices.forEach(d => {
      if (d.group_name && GROUP_UIDS[d.group_name]) {
        groupsInUse.add(d.group_name);
      }
    });

    // 2. 依排序加入群組節點
    GROUP_ORDER.forEach(g => {
      if (groupsInUse.has(g)) {
        arr.push({ Name: g, Type: 2, Uid: GROUP_UIDS[g] });
      }
    });

    // 3. 加入設備（依群組順序）
    GROUP_ORDER.forEach(g => {
      const groupDevices = devices.filter(d => d.group_name === g);
      groupDevices.forEach(d => {
        const obj = {};
        if (d.host_address) obj.HostAddress = d.host_address;
        if (d.mac_address) obj.MacAddress = d.mac_address;
        obj.Name = d.name;
        obj.ParentUid = GROUP_UIDS[g];
        obj.Type = 3;
        obj.Uid = wrapUid(d.veyon_uid);
        arr.push(obj);
      });
    });

    return {
      ...VEYON_BASE,
      BuiltinDirectory: {
        NetworkObjects: {
          JsonStoreArray: arr
        }
      }
    };
  }

  // ============ 過濾 ============
  function filterDevices(devices, opts = {}) {
    let list = [...devices];
    if (opts.segment) list = list.filter(d => d.network_segment === opts.segment);
    if (opts.group) list = list.filter(d => d.group_name === opts.group);
    if (opts.classroom_code) list = list.filter(d => d.classroom_code === opts.classroom_code);
    if (opts.ids) list = list.filter(d => opts.ids.includes(d.id));
    return list;
  }

  // ============ 下載檔案 ============
  function download(json, filename = 'veyon.json') {
    const txt = JSON.stringify(json, null, 4);
    const blob = new Blob([txt], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============ 差異比對 ============
  // 從 Veyon JSON 解析出設備陣列（只含 Type=3 的）
  function parseVeyonJSON(veyonJson) {
    try {
      const all = veyonJson?.BuiltinDirectory?.NetworkObjects?.JsonStoreArray || [];
      return all.filter(x => x.Type === 3).map(x => ({
        uid: (x.Uid || '').replace(/[{}]/g, ''),
        name: x.Name,
        host: x.HostAddress,
        mac: x.MacAddress,
        parent_uid: (x.ParentUid || '').replace(/[{}]/g, '')
      }));
    } catch (e) {
      return [];
    }
  }

  // 比對兩個設備陣列，回傳差異
  function diff(oldJson, newDevices) {
    const oldDevs = parseVeyonJSON(oldJson);
    const oldByUid = Object.fromEntries(oldDevs.map(d => [d.uid, d]));
    const newByUid = Object.fromEntries(newDevices.map(d => [(d.veyon_uid || '').replace(/[{}]/g, ''), d]));

    const added = [];   // 新 JSON 有，舊沒有
    const removed = []; // 舊 JSON 有，新沒有
    const changed = []; // 兩邊都有但欄位不同

    // 新的 → 舊的
    for (const [uid, nd] of Object.entries(newByUid)) {
      const od = oldByUid[uid];
      if (!od) {
        added.push({ uid, new: nd });
      } else {
        const diffs = [];
        if (nd.host_address !== od.host) diffs.push({ field: 'IP', old: od.host, new: nd.host_address });
        if ((nd.mac_address || '') !== (od.mac || '')) diffs.push({ field: 'MAC', old: od.mac, new: nd.mac_address });
        if (nd.name !== od.name) diffs.push({ field: '名稱', old: od.name, new: nd.name });
        // 檢查群組
        const oldParent = od.parent_uid;
        const newParent = (GROUP_UIDS[nd.group_name] || '').replace(/[{}]/g, '');
        if (oldParent !== newParent) {
          const oldGroup = Object.entries(GROUP_UIDS).find(([_, u]) => u.replace(/[{}]/g, '') === oldParent)?.[0] || '?';
          diffs.push({ field: '群組', old: oldGroup, new: nd.group_name });
        }
        if (diffs.length > 0) {
          changed.push({ uid, name: nd.name, host: nd.host_address, diffs });
        }
      }
    }

    // 舊的 → 新的 (找消失的)
    for (const [uid, od] of Object.entries(oldByUid)) {
      if (!newByUid[uid]) {
        removed.push({ uid, old: od });
      }
    }

    return { added, removed, changed, oldCount: oldDevs.length, newCount: newDevices.length };
  }

  // ============ 記錄到 Supabase ============
  async function logExport(scope, scopeValue, devices, diffResult) {
    try {
      const C = window.SMES_CONFIG;
      const token = window.SMES_AUTH?.getAccessToken?.();
      if (!C || !token) return;
      const user = window.SMES_AUTH?.getUser?.();

      await fetch(`${C.SUPABASE_URL}/rest/v1/veyon_exports`, {
        method: 'POST',
        headers: {
          apikey: C.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          exported_by: user?.id,
          exported_by_email: user?.email,
          scope,
          scope_value: scopeValue,
          device_count: devices.length,
          devices_snapshot: devices.map(d => ({
            uid: d.veyon_uid, name: d.name, host: d.host_address, mac: d.mac_address, group: d.group_name
          })),
          diff_from_previous: diffResult || null
        })
      });
    } catch (e) {
      console.warn('[veyon-export] log failed', e);
    }
  }

  window.SMES_VEYON = {
    build, filterDevices, download, parseVeyonJSON, diff, logExport,
    GROUP_UIDS, GROUP_ORDER
  };
})();
