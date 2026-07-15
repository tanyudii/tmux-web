package com.tanyudii.tmuxweb.ui.theme

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.ViewColumn
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material.icons.outlined.Widgets
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Glyph tokens for the tmux-web design system. The handoff's own prototype
 * set is Lucide (`components/media/Icon.jsx`) but its README explicitly
 * flags that as a cross-platform stand-in: "production iOS should use SF
 * Symbols and Android should use Material Symbols... swap per platform when
 * building production." For a single Compose Multiplatform UI shared across
 * iOS/Web(/Android), Material Symbols is the swap that's actually available
 * inside Compose — this object is that mapping, so call sites reference
 * [TmuxIcons] rather than `Icons.Outlined.*` directly and stay decoupled
 * from that choice if it ever changes again.
 */
object TmuxIcons {
    val Server: ImageVector = Icons.Outlined.Dns
    val Plus: ImageVector = Icons.Outlined.Add
    val Trash: ImageVector = Icons.Outlined.DeleteOutline
    val ChevronRight: ImageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight
    val ChevronLeft: ImageVector = Icons.AutoMirrored.Outlined.KeyboardArrowLeft
    val ChevronDown: ImageVector = Icons.Outlined.KeyboardArrowDown
    val Terminal: ImageVector = Icons.Outlined.Terminal
    val Close: ImageVector = Icons.Outlined.Close
    val Check: ImageVector = Icons.Outlined.Check
    val Alert: ImageVector = Icons.Outlined.WarningAmber
    val WifiOff: ImageVector = Icons.Outlined.WifiOff
    val Spinner: ImageVector = Icons.Outlined.Autorenew
    val Folder: ImageVector = Icons.Outlined.Folder
    val GitBranch: ImageVector = Icons.Outlined.AccountTree
    val Columns: ImageVector = Icons.Outlined.ViewColumn
    val Link: ImageVector = Icons.Outlined.Link
    val Settings: ImageVector = Icons.Outlined.Settings
    val Circle: ImageVector = Icons.Outlined.Circle
    val File: ImageVector = Icons.AutoMirrored.Outlined.InsertDriveFile
    val Refresh: ImageVector = Icons.Outlined.Refresh
    val MoreVertical: ImageVector = Icons.Outlined.MoreVert
    val ArrowLeft: ImageVector = Icons.AutoMirrored.Outlined.ArrowBack
    val Play: ImageVector = Icons.Outlined.PlayArrow
    val Square: ImageVector = Icons.Outlined.Stop
    val Box: ImageVector = Icons.Outlined.Widgets
    val ExternalLink: ImageVector = Icons.AutoMirrored.Outlined.OpenInNew
}
