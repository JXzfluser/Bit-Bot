package com.bitbot.host.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Bit Bot 设计系统 —— 中性画布 + 一个强调色 + 一套排版/圆角/间距 token。
 *
 * 为什么必须单独有这一层：旧版首屏是 setContent { MaterialTheme { ... } }，一个 token
 * 都没定义，直接顶着 Material 3 的框架默认紫（#6750A4、secondaryContainer #E7E0EC、
 * 底色 #FEF7FF 这种带紫调的白）上线。手机上看就是一个「没做完的 demo」：底色发紫、
 * 气泡是紫色 tonal、发送是方形文字按钮。主流 AI 助手类 App 的共通语法是：
 *   1. 中性（近黑 / 近白）画布，全程只有一条强调色；
 *   2. 用户消息是气泡，模型回复直接铺在画布上，不给每句话打「你」「助手」标签；
 *   3. 输入区是一颗胶囊，右侧一个圆形发送键；
 *   4. 空屏只留一个主行动。
 * 这里按这套语法做，不是照抄某一款 App 的像素（也不声称和任何 App 视觉一致）。
 */
object BitBotPalette {
  /** 唯一强调色：蓝。浅色用实色，深色底上换成更亮的同色系，保证对比度。 */
  val Accent = Color(0xFF1D6FE0)
  val AccentOnDark = Color(0xFF7FB2FF)
  val AccentSoftLight = Color(0xFFDFEBFF)
  val AccentSoftDark = Color(0xFF173055)

  val CanvasLight = Color(0xFFFFFFFF)
  val CanvasDark = Color(0xFF0C0D10)
  val RaisedLight = Color(0xFFF1F3F6)
  val RaisedDark = Color(0xFF1D1F22)
  val TextLight = Color(0xFF14161A)
  val TextDark = Color(0xFFE8EAEC)
  val MutedLight = Color(0xFF5A6270)
  val MutedDark = Color(0xFF98A1AE)
  val LineLight = Color(0xFFD9DADC)
  val LineDark = Color(0xFF46484A)

  val DangerLight = Color(0xFFBE3E36)
  val DangerDark = Color(0xFFF1877F)

  /** 状态点：没连上就是中性灰，连上了才是强调色 —— 不用绿色吓人。 */
  val DotIdleLight = Color(0xFFB9C0CB)
  val DotIdleDark = Color(0xFF5F6874)
}

private val BitBotLightScheme =
  lightColorScheme(
    primary = BitBotPalette.Accent,
    onPrimary = Color.White,
    primaryContainer = BitBotPalette.AccentSoftLight,
    onPrimaryContainer = Color(0xFF0F3369),
    secondary = BitBotPalette.Accent,
    onSecondary = Color.White,
    secondaryContainer = BitBotPalette.AccentSoftLight,
    onSecondaryContainer = Color(0xFF0F3369),
    tertiary = BitBotPalette.Accent,
    onTertiary = Color.White,
    tertiaryContainer = BitBotPalette.AccentSoftLight,
    onTertiaryContainer = Color(0xFF0F3369),
    background = BitBotPalette.CanvasLight,
    onBackground = BitBotPalette.TextLight,
    surface = BitBotPalette.CanvasLight,
    onSurface = BitBotPalette.TextLight,
    surfaceVariant = BitBotPalette.RaisedLight,
    onSurfaceVariant = BitBotPalette.MutedLight,
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF7F8FA),
    surfaceContainer = Color(0xFFF2F4F7),
    surfaceContainerHigh = Color(0xFFEBEEF3),
    surfaceContainerHighest = Color(0xFFE3E7ED),
    inverseSurface = Color(0xFF1B1E24),
    inverseOnSurface = Color(0xFFF2F4F7),
    outline = BitBotPalette.LineLight,
    outlineVariant = Color(0xFFE6E9EF),
    error = BitBotPalette.DangerLight,
    onError = Color.White,
    errorContainer = Color(0xFFFBE6E4),
    onErrorContainer = Color(0xFF7A201B),
    scrim = Color(0xFF000000),
  )

private val BitBotDarkScheme =
  darkColorScheme(
    primary = BitBotPalette.AccentOnDark,
    onPrimary = Color(0xFF062048),
    primaryContainer = BitBotPalette.AccentSoftDark,
    onPrimaryContainer = Color(0xFFD3E5FF),
    secondary = BitBotPalette.AccentOnDark,
    onSecondary = Color(0xFF062048),
    secondaryContainer = BitBotPalette.AccentSoftDark,
    onSecondaryContainer = Color(0xFFD3E5FF),
    tertiary = BitBotPalette.AccentOnDark,
    onTertiary = Color(0xFF062048),
    tertiaryContainer = BitBotPalette.AccentSoftDark,
    onTertiaryContainer = Color(0xFFD3E5FF),
    background = BitBotPalette.CanvasDark,
    onBackground = BitBotPalette.TextDark,
    surface = BitBotPalette.CanvasDark,
    onSurface = BitBotPalette.TextDark,
    surfaceVariant = BitBotPalette.RaisedDark,
    onSurfaceVariant = BitBotPalette.MutedDark,
    surfaceContainerLowest = Color(0xFF07080A),
    surfaceContainerLow = Color(0xFF0F1115),
    surfaceContainer = Color(0xFF14161A),
    surfaceContainerHigh = Color(0xFF1B1E24),
    surfaceContainerHighest = Color(0xFF23272E),
    inverseSurface = Color(0xFFE9EBF0),
    inverseOnSurface = Color(0xFF1B1E24),
    outline = BitBotPalette.LineDark,
    outlineVariant = Color(0xFF272C34),
    error = BitBotPalette.DangerDark,
    onError = Color(0xFF430F0D),
    errorContainer = Color(0xFF5C1E1A),
    onErrorContainer = Color(0xFFFBD9D5),
    scrim = Color(0xFF000000),
  )

/**
 * 画布之外还需要的那几个颜色（消息气泡、状态点）。
 * 不塞进 colorScheme 是为了不把「气泡」和「primaryContainer」绑死 ——
 * 旧版就是因为气泡直接用 primaryContainer，整屏紫调全从那里来。
 */
data class BitBotExtras(
  val userBubble: Color,
  val onUserBubble: Color,
  val dotIdle: Color,
)

private val ExtrasLight =
  BitBotExtras(
    userBubble = BitBotPalette.AccentSoftLight,
    onUserBubble = Color(0xFF0F3369),
    dotIdle = BitBotPalette.DotIdleLight,
  )

private val ExtrasDark =
  BitBotExtras(
    userBubble = BitBotPalette.AccentSoftDark,
    onUserBubble = Color(0xFFD3E5FF),
    dotIdle = BitBotPalette.DotIdleDark,
  )

val LocalBitBotExtras = staticCompositionLocalOf { ExtrasLight }

/** 间距 token：旧版是 4/6/8/10/12/16/24 混着随手写，这里收成一套。 */
object BitBotSpace {
  val xxs = 2.dp
  val xs = 4.dp
  val sm = 8.dp
  val md = 12.dp
  val lg = 16.dp
  val xl = 20.dp
  val xxl = 24.dp
  val xxxl = 32.dp
}

/** 圆角 token：胶囊、气泡、卡片各一档。 */
object BitBotRadius {
  val chip = 14.dp
  val field = 26.dp
  val bubble = 20.dp
  val card = 16.dp
}

private val BitBotTypography =
  Typography(
    displaySmall =
      TextStyle(
        fontSize = 30.sp,
        lineHeight = 36.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.3).sp,
      ),
    headlineSmall =
      TextStyle(
        fontSize = 22.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.sp,
      ),
    titleLarge =
      TextStyle(
        fontSize = 18.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.sp,
      ),
    titleMedium =
      TextStyle(
        fontSize = 15.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.1.sp,
      ),
    bodyLarge =
      TextStyle(
        fontSize = 16.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.15.sp,
      ),
    bodyMedium =
      TextStyle(
        fontSize = 15.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.2.sp,
      ),
    bodySmall =
      TextStyle(
        fontSize = 13.sp,
        lineHeight = 18.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.15.sp,
      ),
    labelLarge =
      TextStyle(
        fontSize = 15.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.1.sp,
      ),
    labelMedium =
      TextStyle(
        fontSize = 12.sp,
        lineHeight = 16.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.2.sp,
      ),
    labelSmall =
      TextStyle(
        fontSize = 11.sp,
        lineHeight = 15.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.2.sp,
      ),
  )

private val BitBotShapes =
  Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(BitBotRadius.card),
    large = RoundedCornerShape(BitBotRadius.bubble),
    extraLarge = RoundedCornerShape(BitBotRadius.field),
  )

@Composable
fun BitBotTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  content: @Composable () -> Unit,
) {
  val extras = if (darkTheme) ExtrasDark else ExtrasLight
  androidx.compose.runtime.CompositionLocalProvider(LocalBitBotExtras provides extras) {
    MaterialTheme(
      colorScheme = if (darkTheme) BitBotDarkScheme else BitBotLightScheme,
      typography = BitBotTypography,
      shapes = BitBotShapes,
      content = content,
    )
  }
}

/** 主题里的 pill / circle 复用，避免各处再手写 RoundedCornerShape。 */
val BitBotPillShape = CircleShape

/** mono 只留给机器码和路径：正文不许用等宽字。 */
val BitBotMonoStyle =
  TextStyle(
    fontFamily = FontFamily.Monospace,
    fontSize = 12.sp,
    lineHeight = 16.sp,
  )
