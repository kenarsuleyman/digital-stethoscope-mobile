package com.digitalstethoscope

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Raw PCM capture via AudioRecord using AudioSource.UNPROCESSED so the OS does
 * NOT apply high-pass / AGC / noise-suppression to the signal. The default MIC
 * source (used by most libraries) strips low frequencies "for voice", which
 * destroys heart sounds (20-150 Hz) and makes the band-pass filter look like a
 * no-op. Falls back to VOICE_RECOGNITION then MIC if UNPROCESSED is unsupported.
 *
 * Emits each frame to JS as an `audioFrame` event: an array of Int16 PCM values.
 */
class AudioCaptureModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  @Volatile private var recorder: AudioRecord? = null
  @Volatile private var running = false
  private var thread: Thread? = null

  override fun getName(): String = "AudioCapture"

  private val sources = intArrayOf(
    MediaRecorder.AudioSource.UNPROCESSED,
    MediaRecorder.AudioSource.VOICE_RECOGNITION,
    MediaRecorder.AudioSource.MIC,
  )

  private fun disableEffects(sessionId: Int) {
    try {
      if (AutomaticGainControl.isAvailable()) {
        AutomaticGainControl.create(sessionId)?.enabled = false
      }
    } catch (_: Exception) {}
    try {
      if (NoiseSuppressor.isAvailable()) {
        NoiseSuppressor.create(sessionId)?.enabled = false
      }
    } catch (_: Exception) {}
    try {
      if (AcousticEchoCanceler.isAvailable()) {
        AcousticEchoCanceler.create(sessionId)?.enabled = false
      }
    } catch (_: Exception) {}
  }

  @ReactMethod
  fun start(sampleRate: Int, frameLength: Int, promise: Promise) {
    if (running) {
      promise.resolve(null)
      return
    }
    try {
      val minBuf = AudioRecord.getMinBufferSize(
        sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
      )
      val bufSize = maxOf(minBuf, frameLength * 2 * 4)

      var rec: AudioRecord? = null
      var usedSource = -1
      for (src in sources) {
        try {
          val r = AudioRecord(
            src, sampleRate, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, bufSize,
          )
          if (r.state == AudioRecord.STATE_INITIALIZED) {
            rec = r
            usedSource = src
            break
          }
          r.release()
        } catch (_: Exception) {
          // try next source
        }
      }
      if (rec == null) {
        promise.reject("ERR_AUDIO", "Could not initialize AudioRecord")
        return
      }

      disableEffects(rec.audioSessionId)
      recorder = rec
      rec.startRecording()
      running = true

      thread = Thread {
        val buf = ShortArray(frameLength)
        val emitter = reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        while (running) {
          val n = rec.read(buf, 0, frameLength)
          if (n > 0) {
            val arr = Arguments.createArray()
            for (i in 0 until n) arr.pushInt(buf[i].toInt())
            emitter.emit("audioFrame", arr)
          } else if (n < 0) {
            break
          }
        }
      }.also { it.start() }

      // Report what Android actually opened (test recordings store this next to the WAV).
      val info = Arguments.createMap()
      info.putString("source", when (usedSource) {
        MediaRecorder.AudioSource.UNPROCESSED -> "UNPROCESSED"
        MediaRecorder.AudioSource.VOICE_RECOGNITION -> "VOICE_RECOGNITION"
        MediaRecorder.AudioSource.MIC -> "MIC"
        else -> usedSource.toString()
      })
      info.putInt("sampleRate", rec.sampleRate)
      info.putInt("bufferBytes", bufSize)
      val routed = rec.routedDevice
      info.putString("routedDevice", routed?.productName?.toString() ?: "")
      info.putInt("routedDeviceType", routed?.type ?: -1)
      promise.resolve(info)
    } catch (e: Exception) {
      promise.reject("ERR_AUDIO", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    running = false
    try { thread?.join(500) } catch (_: Exception) {}
    thread = null
    try { recorder?.stop() } catch (_: Exception) {}
    try { recorder?.release() } catch (_: Exception) {}
    recorder = null
    promise.resolve(null)
  }

  @ReactMethod
  fun isRecording(promise: Promise) {
    promise.resolve(running)
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    running = false
    try { recorder?.stop() } catch (_: Exception) {}
    try { recorder?.release() } catch (_: Exception) {}
    recorder = null
    super.invalidate()
  }
}
