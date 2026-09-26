# OffBeat

Reproductor de audio local, estilo YouTube Music, **100% offline**.
Construido con HTML/CSS/JS empaquetado en Android con **Capacitor 8**.

- **App ID:** `com.mauricioricotti.offbeat`
- **Mínimo soportado:** Android 13 (API 33) · Target API 36
- **Compilación:** 100% en la nube con GitHub Actions (no requiere Android Studio ni SDK en tu PC)

## Estructura

```
offbeat/
├── www/                        # La app (HTML/CSS/JS)
├── android/
│   ├── app/                    # Módulo de la app (MainActivity registra plugins)
│   ├── media-scanner/          # Plugin nativo Kotlin (MediaStore) — Etapa 2
│   │   └── src/main/java/com/mauricioricotti/offbeat/mediascanner/
│   │       └── MediaScannerPlugin.kt
│   └── ...
├── .github/workflows/build-apk.yml  # Pipeline de GitHub Actions (en la raíz del repo)
├── capacitor.config.json       # Config de Capacitor (appId, nombre, webDir)
└── package.json
```

## Plugin nativo: MediaScanner (Etapa 2)

Plugin Capacitor en Kotlin que lee la biblioteca de música local vía **MediaStore**.
Se usa desde JS sin paquete npm, vía `window.Capacitor.Plugins.MediaScanner`:

| Método | Devuelve |
|---|---|
| `requestPermission()` | `{ granted }` — flujo del diálogo del sistema (`READ_MEDIA_AUDIO` en Android 13+) |
| `scanLibrary()` | `{ total, tracks: [{ id, title, artist, album, albumId, durationMs }] }` |
| `getAlbumArt({ albumId })` | `{ hasArt, mime?, data? }` — carátula JPEG ~320 px en base64 |
| `openAppSettings()` | abre Ajustes del sistema (para habilitar el permiso a mano) |

Detalles:
- Los permisos se declaran en `@CapacitorPlugin(permissions = ...)` y se resuelven
  con un método `@PermissionCallback` (API de permisos de **Capacitor 8**).
- La lista se ordena por artista → álbum → pista, y descarta timbres/notificaciones (`IS_MUSIC != 0`).
- Las carátulas se piden **lazy** desde el web (solo lo visible) y se cachean por álbum.
- La clase base es `Plugin` (Capacitor 8 renombró `JSPlugin` → `Plugin`) y el registro
  se hace en `MainActivity.onCreate` **antes** de `super.onCreate()`.

## Flujo de trabajo (CI)

Cada `git push` a `main`:

1. GitHub Actions instala Node 24 + **JDK 21** + Android SDK.
   (JDK 21 es obligatorio: Capacitor 8 no compila con 17.)
2. `npx cap sync android` copia `www/` al proyecto Android y regenera
   `capacitor-cordova-android-plugins/` (con solo `cap copy` no basta en un clone limpio).
3. `./gradlew assembleDebug` compila (incluye el módulo Kotlin).
4. Publica el APK como **artifact** `offbeat-debug`.

Descarga: pestaña **Actions** → run → **Artifacts** → `offbeat-debug`.

## Instalar en el celular (Moto G23)

1. Pasá el APK al celular y tocálo; aceptá "Instalar aplicaciones desconocidas".
2. Abrí OffBeat → "Conceder acceso" → aceptá el permiso de audio.
3. Listá tus canciones, buscá por título/artista/álbum. Tocar una canción aún no reproduce (Etapa 3).

⚠️ Cada build en CI firma con una clave debug distinta: si al actualizar Android dice
*"No se instaló la app"*, desinstalá el anterior primero (no se pierde nada todavía).
Keystore fijo llegará en una etapa futura.

## Desarrollo local (sin Android Studio)

Tu PC solo necesita **VS Code + Git + Node.js** (v24).
Probá cambios del web abriendo `www/index.html` en el navegador (modo web, sin permiso).
Cada `commit` + `push` genera el APK nuevo en Actions.

## Estado de las etapas

- [x] **Etapa 1** — Proyecto base + pipeline CI ("Hola OffBeat")
- [x] **Etapa 2** — Plugin Kotlin MediaScanner + lista de canciones con carátulas (sin reproducción)
- [ ] **Etapa 3** — (pendiente definir) reproductor con barra de progreso
