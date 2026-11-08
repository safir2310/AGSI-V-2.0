/*
 * AGSI POS — proguard (rilis: minifyEnabled false, jadi aturan ini cadangan)
 */
-keep class com.agsi.pos.** { *; }
-keepclassmembers class com.agsi.pos.MainActivity$NativeBridge { public *; }
