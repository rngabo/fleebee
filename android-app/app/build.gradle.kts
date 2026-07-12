plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

fun asBuildConfigString(value: String): String {
    val escaped = value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
    return "\"$escaped\""
}

val gatewayBackendBaseUrl = providers.gradleProperty("gatewayBackendBaseUrl")
    .orElse(providers.environmentVariable("GATEWAY_BACKEND_BASE_URL"))
    .orElse("http://127.0.0.1:4100")

val gatewayDeviceId = providers.gradleProperty("gatewayDeviceId")
    .orElse(providers.environmentVariable("GATEWAY_DEVICE_ID"))
    .orElse("android-home-gateway")

val gatewayFixedLocation = providers.gradleProperty("gatewayFixedLocation")
    .orElse(providers.environmentVariable("GATEWAY_FIXED_LOCATION"))
    .orElse("Home gateway")

val gatewayNetworkLabel = providers.gradleProperty("gatewayNetworkLabel")
    .orElse(providers.environmentVariable("GATEWAY_NETWORK_LABEL"))
    .orElse("Wi-Fi / mobile fallback")

android {
    namespace = "com.salvi.fleebeemanagement"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.salvi.fleebeemanagement"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "GATEWAY_BACKEND_BASE_URL", asBuildConfigString(gatewayBackendBaseUrl.get()))
        buildConfigField("String", "GATEWAY_DEVICE_ID", asBuildConfigString(gatewayDeviceId.get()))
        buildConfigField("String", "GATEWAY_FIXED_LOCATION", asBuildConfigString(gatewayFixedLocation.get()))
        buildConfigField("String", "GATEWAY_NETWORK_LABEL", asBuildConfigString(gatewayNetworkLabel.get()))

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        buildConfig = true
        viewBinding = true
    }
}

dependencies {

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.navigation.fragment.ktx)
    implementation(libs.androidx.navigation.ui.ktx)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
