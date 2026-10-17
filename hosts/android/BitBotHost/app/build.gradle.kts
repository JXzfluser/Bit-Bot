plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.bitbot.host"
  compileSdk = 34
  defaultConfig {
    applicationId = "com.bitbot.host"
    minSdk = 26
    targetSdk = 34
    versionCode = 1
    versionName = "0.1.0"
  }
  // Store signing scaffold: release keystore via env (still open until secrets present).
  // BITBOT_ANDROID_STORE_FILE / STORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD
  val storeFilePath = System.getenv("BITBOT_ANDROID_STORE_FILE")
  signingConfigs {
    create("release") {
      if (!storeFilePath.isNullOrBlank()) {
        storeFile = file(storeFilePath)
        storePassword = System.getenv("BITBOT_ANDROID_STORE_PASSWORD") ?: ""
        keyAlias = System.getenv("BITBOT_ANDROID_KEY_ALIAS") ?: "bitbot"
        keyPassword = System.getenv("BITBOT_ANDROID_KEY_PASSWORD") ?: ""
      }
    }
  }
  buildTypes {
    getByName("release") {
      signingConfig =
        if (!storeFilePath.isNullOrBlank()) signingConfigs.getByName("release")
        else signingConfigs.getByName("debug")
      isMinifyEnabled = false
    }
    getByName("debug") {
      applicationIdSuffix = ".debug"
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }
  buildFeatures {
    compose = true
  }
  composeOptions {
    kotlinCompilerExtensionVersion = "1.5.14"
  }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
  implementation(composeBom)
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.activity:activity-compose:1.9.0")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.material3:material3")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
