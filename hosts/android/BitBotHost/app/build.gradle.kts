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
  // 国内安卓渠道包 flavors（P4）— APK id 后缀；签名仍需 BITBOT_ANDROID_STORE_*。
  flavorDimensions += "store"
  productFlavors {
    create("universal") {
      dimension = "store"
    }
    create("huawei") {
      dimension = "store"
      applicationIdSuffix = ".huawei"
      resValue("string", "bitbot_store_channel", "huawei")
    }
    create("xiaomi") {
      dimension = "store"
      applicationIdSuffix = ".xiaomi"
      resValue("string", "bitbot_store_channel", "xiaomi")
    }
    create("honor") {
      dimension = "store"
      applicationIdSuffix = ".honor"
      resValue("string", "bitbot_store_channel", "honor")
    }
    create("oppo") {
      dimension = "store"
      applicationIdSuffix = ".oppo"
      resValue("string", "bitbot_store_channel", "oppo")
    }
    create("vivo") {
      dimension = "store"
      applicationIdSuffix = ".vivo"
      resValue("string", "bitbot_store_channel", "vivo")
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
  // 线路解析（assistantText / failureText / SendToUser 投递条）是纯 JSON 逻辑，
  // 放 JVM 单测里跑：不需要 emulator，也不需要真机就能红绿。
  testOptions {
    unitTests.isIncludeAndroidResources = false
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
  testImplementation("junit:junit:4.13.2")
  // android.jar 里的 org.json 在 JVM 单测中是「未 mock 即抛」的空壳，必须给真实现。
  testImplementation("org.json:json:20240303")
}
