package com.mauricioricotti.offbeat.mediascanner

import android.Manifest
import android.content.ContentUris
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.CancellationSignal
import android.provider.MediaStore
import android.util.Base64
import android.util.Size
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.ByteArrayOutputStream

/**
 * MediaScanner — plugin nativo de OffBeat (Etapa 2).
 *
 * Lee la biblioteca de audio local vía MediaStore, sin paquete npm:
 * se usa desde JS como `window.Capacitor.Plugins.MediaScanner`.
 *
 * | Método | Devuelve |
 * |---|---|
 * | `requestPermission()` | `{ granted }` — diálogo del sistema (READ_MEDIA_AUDIO en Android 13+) |
 * | `scanLibrary()` | `{ total, tracks: [{ id, title, artist, album, albumId, durationMs }] }` |
 * | `getAlbumArt({ albumId })` | `{ hasArt, mime?, data? }` — carátula JPEG ~320 px en base64 |
 * | `openAppSettings()` | abre Ajustes del sistema (para habilitar el permiso a mano) |
 *
 * La lista se ordena por artista → álbum → pista y descarta timbres/
 * notificaciones (`IS_MUSIC != 0`).
 */
@CapacitorPlugin(
    name = "MediaScanner",
    permissions = [
        Permission(strings = [Manifest.permission.READ_MEDIA_AUDIO], alias = "audio")
    ]
)
class MediaScannerPlugin : Plugin() {

    private val permissionAlias = "audio"

    // ---------- Permiso ----------

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (getPermissionState(permissionAlias) == PermissionState.GRANTED) {
            val ret = JSObject()
            ret.put("granted", true)
            call.resolve(ret)
        } else {
            requestPermissionForAlias(permissionAlias, call, "permissionCallback")
        }
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        val ret = JSObject()
        ret.put("granted", getPermissionState(permissionAlias) == PermissionState.GRANTED)
        call.resolve(ret)
    }

    // ---------- Biblioteca ----------

    @PluginMethod
    fun scanLibrary(call: PluginCall) {
        if (getPermissionState(permissionAlias) != PermissionState.GRANTED) {
            call.reject("Permiso de audio no concedido", "PERMISSION_DENIED")
            return
        }

        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION
        )

        // Descarta timbres/notificaciones: solo lo marcado como música.
        val selection = MediaStore.Audio.Media.IS_MUSIC + " != 0"

        // Orden: artista → álbum → pista → título (la pista suele venir vacía
        // en archivos sueltos, y el título desempata de forma estable).
        val sortOrder = (
            MediaStore.Audio.Media.ARTIST + " COLLATE NOCASE ASC, " +
                MediaStore.Audio.Media.ALBUM + " COLLATE NOCASE ASC, " +
                MediaStore.Audio.Media.TRACK + " ASC, " +
                MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC"
            )

        val tracks = JSArray()
        try {
            context.contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                null,
                sortOrder
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)

                while (cursor.moveToNext()) {
                    val track = JSObject()
                    track.put("id", cursor.getLong(idCol))
                    track.put("title", cursor.getString(titleCol) ?: "")
                    track.put("artist", cursor.getString(artistCol) ?: "")
                    track.put("album", cursor.getString(albumCol) ?: "")
                    track.put("albumId", cursor.getLong(albumIdCol))
                    track.put("durationMs", cursor.getLong(durationCol))
                    tracks.put(track)
                }
            }
        } catch (err: Exception) {
            call.reject("No se pudo leer MediaStore: " + err.message, err)
            return
        }

        val ret = JSObject()
        ret.put("total", tracks.length())
        ret.put("tracks", tracks)
        call.resolve(ret)
    }

    // ---------- Carátulas ----------

    /**
     * Carátula del álbum como JPEG ~320 px en base64.
     * Se pide lazy desde el web (solo lo visible) y se cachea por álbum ahí.
     */
    @PluginMethod
    fun getAlbumArt(call: PluginCall) {
        val albumId = call.getLong("albumId")
        if (albumId == null) {
            call.reject("Falta albumId")
            return
        }

        if (getPermissionState(permissionAlias) != PermissionState.GRANTED) {
            val ret = JSObject()
            ret.put("hasArt", false)
            call.resolve(ret)
            return
        }

        // Cualquier pista del álbum sirve: loadThumbnail devuelve el arte embebido.
        val trackUri: Uri? = try {
            context.contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                arrayOf(MediaStore.Audio.Media._ID),
                MediaStore.Audio.Media.ALBUM_ID + " = ?",
                arrayOf(albumId.toString()),
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    ContentUris.withAppendedId(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        cursor.getLong(0)
                    )
                } else {
                    null
                }
            }
        } catch (err: Exception) {
            null
        }

        if (trackUri == null) {
            val ret = JSObject()
            ret.put("hasArt", false)
            call.resolve(ret)
            return
        }

        val bitmap: Bitmap? = try {
            context.contentResolver.loadThumbnail(trackUri, Size(320, 320), CancellationSignal())
        } catch (err: Exception) {
            null // sin arte embebido
        }

        if (bitmap == null) {
            val ret = JSObject()
            ret.put("hasArt", false)
            call.resolve(ret)
            return
        }

        try {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
            val ret = JSObject()
            ret.put("hasArt", true)
            ret.put("mime", "image/jpeg")
            ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
            call.resolve(ret)
        } finally {
            bitmap.recycle()
        }
    }

    // ---------- Ajustes del sistema ----------

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        try {
            val intent = Intent(
                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + context.packageName)
            )
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (err: Exception) {
            call.reject("No se pudieron abrir los Ajustes: " + err.message, err)
        }
    }
}
