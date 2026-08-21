$ErrorActionPreference = 'Stop'
$MinimumClipDurationSeconds = 2.0

$video1 = 'D:\桌面\抖音素材\@谁谁 纯测评！！！谨慎买！！！俺自己认可的神裤😏 4K.mp4'
$video2 = 'D:\桌面\抖音素材\@我来 夏天必须要穿上上短下长老钱感拉满的褶皱西裤谁能看出来是172 4K.mp4'
$outputRoot = 'D:\桌面\抖音素材\分类结果_待检查_20260817'

$item1 = Join-Path $outputRoot '款号待确认_黑色阔腿西裤_视频1'
$item2 = Join-Path $outputRoot '款号待确认_灰色褶皱西裤_视频2'

$directories = @(
    (Join-Path $item1 '01_细节讲解'),
    (Join-Path $item1 '02_人物穿搭'),
    (Join-Path $item1 '03_测评讲解'),
    (Join-Path $item1 '99_残留贴纸待二次处理'),
    (Join-Path $item2 '01_人物穿搭'),
    (Join-Path $item2 '04_镜头准备')
)

foreach ($directory in $directories) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$encodeArgs = @(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-map_metadata', '-1'
)

function Get-ValidatedClipDuration {
    param(
        [Parameter(Mandatory = $true)][double]$Start,
        [Parameter(Mandatory = $true)][double]$End,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $duration = [Math]::Round($End - $Start, 6)
    if ($duration -lt $MinimumClipDurationSeconds) {
        throw "Clip duration must be at least $($MinimumClipDurationSeconds.ToString('0.0')) seconds: $duration seconds -> $OutputPath"
    }

    return $duration
}

function Export-SimpleClip {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][double]$Start,
        [Parameter(Mandatory = $true)][double]$End,
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [string]$VideoFilter = ''
    )

    $duration = Get-ValidatedClipDuration -Start $Start -End $End -OutputPath $OutputPath
    Write-Output "PROCESS $(Split-Path -Leaf $OutputPath)"
    $arguments = @(
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', $Start.ToString('0.###', [Globalization.CultureInfo]::InvariantCulture),
        '-i', $InputPath,
        '-t', $duration.ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
    )
    if ($VideoFilter) {
        $arguments += @('-vf', $VideoFilter)
    }
    $arguments += @('-map', '0:v:0', '-map', '0:a:0?')
    $arguments += $encodeArgs
    $arguments += $OutputPath
    & ffmpeg @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "ffmpeg failed: $OutputPath"
    }
}

function Export-ReframedClip {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][double]$Start,
        [Parameter(Mandatory = $true)][double]$End,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $duration = Get-ValidatedClipDuration -Start $Start -End $End -OutputPath $OutputPath
    $filter = '[0:v]crop=1496:2660:332:1180,split=2[bg0][fg0];' +
              '[bg0]scale=2160:3840:flags=lanczos,boxblur=35:8[bg];' +
              '[fg0]crop=980:2660:188:0,scale=1416:3840:flags=lanczos[fg];' +
              '[bg][fg]overlay=(W-w)/2:0,format=yuv420p[v]'

    Write-Output "PROCESS $(Split-Path -Leaf $OutputPath)"
    $arguments = @(
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', $Start.ToString('0.###', [Globalization.CultureInfo]::InvariantCulture),
        '-i', $InputPath,
        '-t', $duration.ToString('0.###', [Globalization.CultureInfo]::InvariantCulture),
        '-filter_complex', $filter,
        '-map', '[v]', '-map', '0:a:0?'
    )
    $arguments += $encodeArgs
    $arguments += $OutputPath
    & ffmpeg @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "ffmpeg failed: $OutputPath"
    }
}

$removeMainCaption = 'delogo=x=280:y=500:w=1600:h=320:show=0'

# Video 1: details and explanation shots. The first two short scenes are merged to satisfy the 2-second minimum.
Export-SimpleClip -InputPath $video1 -Start 1.78 -End 4.02 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '99_残留贴纸待二次处理\001_坐姿到面料近景_00m01.78-00m04.02_密集贴纸残留.mp4')
Export-SimpleClip -InputPath $video1 -Start 4.02 -End 6.62 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '01_细节讲解\002_手持裤装与版型_00m04.02-00m06.62_主字幕已清.mp4')

# This merged scene has many decorative “无广” stamps directly over the garment, so it stays in the review folder.

# Video 1: outfit display shots.
Export-SimpleClip -InputPath $video1 -Start 7.32 -End 11.32 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '02_人物穿搭\001_黑T通勤正侧面_00m07.32-00m11.32_主字幕已清.mp4')
Export-SimpleClip -InputPath $video1 -Start 15.78 -End 20.68 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '02_人物穿搭\002_针织短袖搭配_00m15.78-00m20.68_主字幕已清.mp4')
Export-SimpleClip -InputPath $video1 -Start 23.26 -End 29.28 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '02_人物穿搭\003_粉衬衫搭配_00m23.26-00m29.28_主字幕已清.mp4')
Export-SimpleClip -InputPath $video1 -Start 34.00 -End 39.56 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '02_人物穿搭\004_白T搭配_00m34.00-00m39.56_主字幕已清.mp4')
Export-SimpleClip -InputPath $video1 -Start 45.56 -End 49.00 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '02_人物穿搭\005_秋冬毛衣搭配_00m45.56-00m49.00_主字幕已清.mp4')

# Video 1: test/review statements.
Export-SimpleClip -InputPath $video1 -Start 11.32 -End 15.72 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '03_测评讲解\001_显高显瘦与体型适配_00m11.32-00m15.72_主字幕已清.mp4')
Export-SimpleClip -InputPath $video1 -Start 20.68 -End 23.26 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '03_测评讲解\002_面料与实用性_00m20.68-00m23.26_主字幕已清.mp4')
Export-SimpleClip -InputPath $video1 -Start 29.28 -End 34.00 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '03_测评讲解\003_粉衬衫韩系效果_00m29.28-00m34.00_主字幕已清.mp4')
Export-SimpleClip -InputPath $video1 -Start 39.56 -End 44.68 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '03_测评讲解\004_版型与久坐垂感_00m39.56-00m44.68_主字幕已清.mp4')
Export-SimpleClip -InputPath $video1 -Start 49.00 -End 54.14 -VideoFilter $removeMainCaption -OutputPath (Join-Path $item1 '03_测评讲解\005_秋冬适配与加厚诉求_00m49.00-00m54.14_主字幕已清.mp4')

# Video 2: clean opening frames, then subtitle-free centered reframing for the static outfit sequence.
Export-SimpleClip -InputPath $video2 -Start 0.00 -End 2.60 -OutputPath (Join-Path $item2 '04_镜头准备\001_近景整理服装_00m00.00-00m02.60_原画无字幕.mp4')
Export-ReframedClip -InputPath $video2 -Start 3.50 -End 9.40 -OutputPath (Join-Path $item2 '01_人物穿搭\001_正面全身展示_00m03.50-00m09.40_字幕已清.mp4')
Export-ReframedClip -InputPath $video2 -Start 9.40 -End 12.30 -OutputPath (Join-Path $item2 '01_人物穿搭\002_侧面轮廓展示_00m09.40-00m12.30_字幕已清.mp4')
Export-ReframedClip -InputPath $video2 -Start 12.30 -End 15.67 -OutputPath (Join-Path $item2 '01_人物穿搭\003_背面回转侧面展示_00m12.30-00m15.67_字幕已清.mp4')

Write-Output "DONE $outputRoot"
