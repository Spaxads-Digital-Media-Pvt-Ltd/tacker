/**
 * Option lists for Offer › Targeting › Device Characteristics.
 *
 * The tracking server detects Platform / Browser / Device Brand with ua-parser-js 1.0.x
 * (api-backend/src/lib/ua.ts) and matches them case-insensitively by exact name, so these lists
 * are the names that parser actually emits — from its documented "Possible …" lists plus the
 * literal names in its regex map. A value that isn't one of these can never match a click
 * (e.g. the parser says "Chromium OS", never "Chrome OS"). Typing a custom value is still
 * allowed for names the parser copies verbatim from unusual User-Agents.
 * Refresh when ua-parser-js is upgraded in api-backend.
 */

export const BROWSERS: readonly string[] = [
  '115 Browser', '2345Explorer', '360', '360 Browser', 'Alipay', 'Amaya', 'Android Browser', 'Arora', 'Avant', 'Avast', 'AVG',
  'Baidu', 'Basilisk', 'Blazer', 'Bolt', 'Bowser', 'Brave', 'Camino', 'Chimera', 'Chrome', 'Chrome Headless', 'Chrome WebView',
  'Chromium', 'Cobalt', 'Coc Coc', 'Comodo Dragon', 'Daum', 'Dillo', 'Dolphin', 'Doris', 'DuckDuckGo', 'Edge', 'Electron',
  'Epiphany', 'Facebook', 'Falkon', 'Fennec', 'Firebird', 'Firefox', 'Firefox Focus', 'Firefox Reality', 'Flock', 'Flow',
  'GoBrowser', 'GSA', 'Helio', 'Heytap', 'Huawei Browser', 'iCab', 'ICE Browser', 'IceApe', 'IceCat', 'IceDragon', 'Iceweasel',
  'IE', 'IEMobile', 'Instagram', 'Iridium', 'Iron', 'Jasmine', 'K-Meleon', 'KakaoStory', 'KakaoTalk', 'Kindle', 'Klar', 'Klarna',
  'Konqueror', 'Ladybird', 'LBBROWSER', 'LibreWolf', 'Line', 'LinkedIn', 'Links', 'Lunascape', 'Lynx', 'Maemo', 'Maxthon',
  'Midori', 'Minimo', 'MIUI Browser', 'Mobile Safari', 'Mosaic', 'Mozilla', 'NetFront', 'Netscape', 'NetSurf', 'NokiaBrowser',
  'Obigo', 'Oculus Browser', 'OmniWeb', 'Opera', 'Opera Coast', 'Opera GX', 'Opera Mini', 'Opera Mobi', 'Opera Tablet',
  'Opera Touch', 'PaleMoon', 'PhantomJS', 'Phoenix', 'Pico Browser', 'Polaris', 'Puffin', 'QQ', 'QQBrowser', 'QQBrowserLite',
  'Quark', 'QupZilla', 'RockMelt', 'Safari', 'Sailfish Browser', 'Samsung Internet', 'SeaMonkey', 'Silk', 'Skyfire', 'Sleipnir',
  'SlimBoat', 'SlimBrowser', 'SlimJet', 'Smart Lenovo Browser', 'Snapchat', 'Sogou Explorer', 'Sogou Mobile', 'Swiftfox',
  'Tesla', 'TikTok', 'Tizen Browser', 'Twitter', 'UCBrowser', 'UP.Browser', 'Vivaldi', 'Vivo Browser', 'w3m', 'Waterfox',
  'WeChat', 'Weibo', 'Whale Browser', 'Wolvic', 'Yandex',
];

/** Shown first in the Browser picker (most of real-world traffic). */
export const POPULAR_BROWSERS: readonly string[] = [
  'Chrome', 'Mobile Safari', 'Safari', 'Edge', 'Firefox', 'Samsung Internet', 'Opera', 'Chrome WebView', 'UCBrowser', 'Yandex', 'Brave', 'Facebook', 'Instagram',
];

/** Operating-system names (the Platform dimension). */
export const PLATFORMS: readonly string[] = [
  'AIX', 'Amiga OS', 'Android', 'Android-x86', 'Arch', 'Bada', 'BeOS', 'BlackBerry', 'CentOS', 'Chromecast', 'Chromium OS',
  'Contiki', 'Debian', 'Deepin', 'DragonFly', 'elementary OS', 'Fedora', 'Firefox OS', 'FreeBSD', 'Fuchsia', 'Gentoo', 'GhostBSD',
  'GNU', 'Haiku', 'HarmonyOS', 'HP-UX', 'Hurd', 'iOS', 'Joli', 'KaiOS', 'Linpus', 'Linspire', 'Linux', 'Mac OS', 'Maemo', 'Mageia',
  'Mandriva', 'Manjaro', 'MeeGo', 'Minix', 'Mint', 'Morph OS', 'NetBSD', 'NetRange', 'NetTV', 'Nintendo', 'OpenBSD', 'OpenHarmony',
  'OpenVMS', 'OS/2', 'Palm', 'PC-BSD', 'PCLinuxOS', 'Plan9', 'PlayStation', 'QNX', 'Raspbian', 'RedHat', 'RIM Tablet OS', 'RISC OS',
  'Sabayon', 'Sailfish', 'SerenityOS', 'Series40', 'Slackware', 'Solaris', 'SUSE', 'Symbian', 'Tizen', 'Ubuntu', 'Ubuntu Touch',
  'Unix', 'VectorLinux', 'Viera', 'watchOS', 'WebOS', 'Windows', 'Windows IoT', 'Windows Mobile', 'Windows Phone', 'Zenwalk',
];

export const POPULAR_PLATFORMS: readonly string[] = ['Windows', 'Android', 'iOS', 'Mac OS', 'Linux', 'Chromium OS', 'Ubuntu', 'HarmonyOS'];

/** Device manufacturers (only reported for mobile/tablet/TV User-Agents). */
export const DEVICE_BRANDS: readonly string[] = [
  'Acer', 'Advan', 'Alcatel', 'Amazon', 'Apple', 'Archos', 'ASUS', 'AT&T', 'Barnes & Noble', 'BenQ', 'BlackBerry', 'Cat', 'Dell',
  'Dragon Touch', 'Energizer', 'Envizen', 'Essential', 'Facebook', 'Fairphone', 'GeeksPhone', 'Generic', 'Google', 'HMD', 'Honor',
  'HP', 'HTC', 'Huawei', 'IMO', 'Infinix', 'Insignia', 'itel', 'Jolla', 'Kobo', 'Lenovo', 'LG', 'LvTel', 'MachSpeed', 'Meizu',
  'Micromax', 'Microsoft', 'Motorola', 'Nexian', 'NextBook', 'Nintendo', 'Nokia', 'Nothing', 'NuVision', 'Nvidia', 'OnePlus',
  'OPPO', 'Ouya', 'Palm', 'Panasonic', 'Pebble', 'Polytron', 'RCA', 'Realme', 'RIM', 'Roku', 'Rotor', 'Samsung', 'Sharp',
  'Siemens', 'Smartfren', 'Sony', 'SonyEricsson', 'Sprint', 'Swiss', 'TCL', 'Tecno', 'Tesla', 'Ulefone', 'Verizon', 'Vivo',
  'Vodafone', 'Voice', 'Xbox', 'Xiaomi', 'Zebra', 'Zeki', 'ZTE',
];

export const POPULAR_BRANDS: readonly string[] = ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'OPPO', 'Vivo', 'Realme', 'Google', 'Motorola', 'OnePlus', 'Honor', 'Tecno', 'Infinix'];

/**
 * OS versions per platform, as ua-parser-js reports them. Matching is by prefix, so "17" covers
 * 17.x. Windows 11 sends the same token as 10 ("NT 10.0") and is reported as "10"; browsers on
 * macOS 11+ still send "10_15_7", so most Mac traffic reports 10.15.
 */
export const OS_VERSIONS: Readonly<Record<string, readonly string[]>> = {
  iOS: ['26', '18', '17', '16', '15', '14', '13', '12'],
  Android: ['16', '15', '14', '13', '12', '11', '10', '9', '8.1', '8.0', '7.1', '7.0', '6.0', '5.1', '5.0'],
  Windows: ['10', '8.1', '8', '7', 'Vista', 'XP', 'RT'],
  'Mac OS': ['10.15', '10.14', '10.13', '10.12', '10.11', '11', '12', '13', '14', '15'],
  HarmonyOS: ['5', '4', '3', '2'],
};

/** ISO 639-1 base languages (Debian iso-codes) — the Language dimension also accepts these. */
const LANGUAGE_BASES = 'aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'.split(' ');

/** Common regional variants browsers send in Accept-Language. */
const LANGUAGE_VARIANTS = [
  'en-US', 'en-GB', 'en-IN', 'en-AU', 'en-CA', 'en-NZ', 'en-IE', 'en-ZA', 'en-SG', 'en-PH', 'es-ES', 'es-MX', 'es-419', 'es-AR',
  'es-CO', 'es-US', 'fr-FR', 'fr-CA', 'fr-BE', 'fr-CH', 'de-DE', 'de-AT', 'de-CH', 'pt-BR', 'pt-PT', 'it-IT', 'nl-NL', 'nl-BE',
  'zh-CN', 'zh-TW', 'zh-HK', 'ar-SA', 'ar-EG', 'ar-AE', 'hi-IN', 'bn-IN', 'bn-BD', 'ta-IN', 'te-IN', 'mr-IN', 'ru-RU', 'ja-JP',
  'ko-KR', 'tr-TR', 'pl-PL', 'id-ID', 'ms-MY', 'th-TH', 'vi-VN', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'el-GR', 'he-IL', 'uk-UA',
  'ro-RO', 'cs-CZ', 'hu-HU', 'ur-PK', 'fil-PH',
];

export const POPULAR_LANGUAGES: readonly string[] = ['en', 'en-US', 'en-GB', 'es', 'fr', 'de', 'pt', 'pt-BR', 'hi', 'ar', 'zh', 'ja', 'ru', 'id'];

let langNames: Intl.DisplayNames | null | undefined;
/** "en-US" → "American English (en-US)"; unknown tags fall back to the tag itself. */
export function languageLabel(tag: string): string {
  if (langNames === undefined) {
    try { langNames = new Intl.DisplayNames(['en'], { type: 'language' }); } catch { langNames = null; }
  }
  let name: string | undefined;
  try { name = langNames?.of(tag); } catch { name = undefined; }
  return name && name.toLowerCase() !== tag.toLowerCase() ? `${name} (${tag})` : tag;
}

export const LANGUAGE_TAGS: readonly string[] = [...LANGUAGE_BASES, ...LANGUAGE_VARIANTS];
