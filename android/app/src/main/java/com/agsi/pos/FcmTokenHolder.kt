package com.agsi.pos

/** Token FCM terkini perangkat — diisi PushService.onNewToken & MainActivity. */
object FcmTokenHolder {
    @Volatile
    var token: String? = null
}
