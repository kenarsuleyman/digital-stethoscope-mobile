package com.digitalstethoscope

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Enumerates audio INPUT devices via AudioManager and notifies JS when devices
 * are plugged/unplugged. Used to detect whether the USB-C stethoscope (a USB
 * Audio Class device) is actually connected, rather than silently falling back
 * to the built-in microphone.
 */
class AudioDevicesModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val audioManager: AudioManager =
    reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var callback: AudioDeviceCallback? = null

  override fun getName(): String = "AudioDevices"

  private fun typeName(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtin_mic"
    AudioDeviceInfo.TYPE_USB_DEVICE -> "usb_device"
    AudioDeviceInfo.TYPE_USB_HEADSET -> "usb_headset"
    AudioDeviceInfo.TYPE_USB_ACCESSORY -> "usb_accessory"
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired_headset"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth_sco"
    AudioDeviceInfo.TYPE_TELEPHONY -> "telephony"
    else -> "type_$type"
  }

  private fun isUsb(type: Int): Boolean =
    type == AudioDeviceInfo.TYPE_USB_DEVICE ||
      type == AudioDeviceInfo.TYPE_USB_HEADSET ||
      type == AudioDeviceInfo.TYPE_USB_ACCESSORY

  private fun inputsArray(): WritableArray {
    val arr = Arguments.createArray()
    val devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
    for (d in devices) {
      val m: WritableMap = Arguments.createMap()
      m.putInt("type", d.type)
      m.putString("typeName", typeName(d.type))
      m.putBoolean("isUsb", isUsb(d.type))
      m.putString("productName", d.productName?.toString() ?: "")
      m.putInt("id", d.id)
      arr.pushMap(m)
    }
    return arr
  }

  @ReactMethod
  fun listInputs(promise: Promise) {
    try {
      promise.resolve(inputsArray())
    } catch (e: Exception) {
      promise.reject("ERR_AUDIO_DEVICES", e.message, e)
    }
  }

  @ReactMethod
  fun startObserving() {
    if (callback != null) return
    val cb = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = emitChanged()
      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = emitChanged()
    }
    callback = cb
    audioManager.registerAudioDeviceCallback(cb, Handler(Looper.getMainLooper()))
  }

  @ReactMethod
  fun stopObserving() {
    callback?.let { audioManager.unregisterAudioDeviceCallback(it) }
    callback = null
  }

  private fun emitChanged() {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("audioDevicesChanged", inputsArray())
  }

  // Required so JS NativeEventEmitter doesn't warn.
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    stopObserving()
    super.invalidate()
  }
}
