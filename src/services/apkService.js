let cachedApkUrl = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

const FALLBACK_APK_URL = 'https://huggingface.co/spaces/axel785/kingdoom-whatsapp/resolve/main/releases/Kingdoom_5.0.1.apk';
const REPO_API_URL = 'https://api.github.com/repos/XxxRaiconxxX/Kingdoom-fichas/releases/latest';

export async function getLatestApkUrl() {
  const now = Date.now();
  
  if (cachedApkUrl && (now - lastFetchTime < CACHE_DURATION_MS)) {
    return cachedApkUrl;
  }

  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json'
    };
    
    // Usar el token si está disponible en .env (requerido si el repo es privado)
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(REPO_API_URL, { headers });
    
    if (!response.ok) {
      console.warn(`[apkService] GitHub API respondió con estado: ${response.status}. Usando fallback o caché.`);
      return cachedApkUrl || FALLBACK_APK_URL;
    }
    
    const data = await response.json();
    
    // Buscar el archivo con extensión .apk en los assets
    const apkAsset = data.assets?.find(asset => asset.name.endsWith('.apk'));
    
    if (apkAsset && apkAsset.browser_download_url) {
      cachedApkUrl = apkAsset.browser_download_url;
      lastFetchTime = now;
      console.log(`[apkService] Nueva URL del APK actualizada: ${cachedApkUrl}`);
      return cachedApkUrl;
    } else {
      console.warn('[apkService] No se encontró ningún archivo .apk en el último release de GitHub. Usando fallback.');
      return cachedApkUrl || FALLBACK_APK_URL;
    }
    
  } catch (error) {
    console.error(`[apkService] Error obteniendo el último APK: ${error.message}`);
    return cachedApkUrl || FALLBACK_APK_URL;
  }
}
