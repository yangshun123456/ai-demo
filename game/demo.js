#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/**
 * 使用方式：
 *
 * 1. JSON 时间段：
 * node webp-splice.js input.webp output.webp \
 *   --ranges '[["0","2.5"],["5","8"],["00:00:10","00:00:12.5"]]'
 *
 * 2. 简写时间段：
 * node webp-splice.js input.webp output.webp \
 *   --ranges "0-2.5,5-8,10-12.5"
 *
 * 3. 设置帧率和画质：
 * node webp-splice.js input.webp output.webp \
 *   --ranges "0-2,4-6" \
 *   --fps 20 \
 *   --quality 85
 */

function printHelp() {
  console.log(`
动态 WebP 裁剪拼接工具

用法：
  node webp-splice.js <输入文件> <输出文件> --ranges <时间段> [选项]

时间段格式：

  JSON 格式：
    --ranges '[["0","2.5"],["5","8"]]'

  简写格式：
    --ranges "0-2.5,5-8,10-12"

时间支持：
  12.5
  00:00:12.500
  01:02:03.500

选项：
  --fps <数字>         输出帧率，默认 20
  --quality <数字>     输出画质，范围 0-100，默认 85
  --lossless           使用无损 WebP
  --loop <数字>        循环次数，0 表示无限循环，默认 0
  --background <颜色>  背景颜色，默认透明
  --help               显示帮助

示例：
  node webp-splice.js input.webp output.webp --ranges "0-2,5-8"

  node webp-splice.js input.webp output.webp \\
    --ranges '[["00:00:00","00:00:02.5"],["00:00:05","00:00:08"]]' \\
    --fps 25 \\
    --quality 90
`)
}

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    ranges: null,
    fps: 20,
    quality: 85,
    lossless: false,
    loop: 0,
    background: '0x00000000',
  }

  const positional = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    switch (arg) {
      case '--ranges':
        args.ranges = argv[++i]
        break

      case '--fps':
        args.fps = Number(argv[++i])
        break

      case '--quality':
        args.quality = Number(argv[++i])
        break

      case '--loop':
        args.loop = Number(argv[++i])
        break

      case '--background':
        args.background = argv[++i]
        break

      case '--lossless':
        args.lossless = true
        break

      case '--help':
      case '-h':
        args.help = true
        break

      default:
        if (arg.startsWith('--')) {
          throw new Error(`未知参数：${arg}`)
        }

        positional.push(arg)
    }
  }

  args.input = positional[0]
  args.output = positional[1]

  return args
}

/**
 * 把时间转换为秒。
 *
 * 支持：
 * 12.5
 * 00:00:12.5
 * 01:02:03.5
 */
function parseTime(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`无效时间：${value}`)
    }

    return value
  }

  const text = String(value).trim()

  if (!text) {
    throw new Error('时间不能为空')
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Number(text)
  }

  const parts = text.split(':').map(Number)

  if (
      parts.length < 2 ||
      parts.length > 3 ||
      parts.some((item) => !Number.isFinite(item) || item < 0)
  ) {
    throw new Error(`无效时间格式：${text}`)
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts
    return minutes * 60 + seconds
  }

  const [hours, minutes, seconds] = parts
  return hours * 3600 + minutes * 60 + seconds
}

function parseRanges(value) {
  if (!value) {
    throw new Error('缺少 --ranges 参数')
  }

  let rawRanges

  const trimmed = value.trim()

  if (trimmed.startsWith('[')) {
    try {
      rawRanges = JSON.parse(trimmed)
    } catch (error) {
      throw new Error(`时间段 JSON 解析失败：${error.message}`)
    }
  } else {
    rawRanges = trimmed.split(',').map((item) => {
      const match = item
          .trim()
          .match(/^(.+?)\s*(?:-|~)\s*(.+)$/)

      if (!match) {
        throw new Error(`无效时间段：${item}`)
      }

      return [match[1], match[2]]
    })
  }

  if (!Array.isArray(rawRanges) || rawRanges.length === 0) {
    throw new Error('至少需要一个时间段')
  }

  return rawRanges.map((range, index) => {
    if (!Array.isArray(range) || range.length !== 2) {
      throw new Error(
          `第 ${index + 1} 个时间段格式错误，应为 [开始时间, 结束时间]`,
      )
    }

    const start = parseTime(range[0])
    const end = parseTime(range[1])

    if (end <= start) {
      throw new Error(
          `第 ${index + 1} 个时间段结束时间必须大于开始时间：${start} -> ${end}`,
      )
    }

    return {
      start,
      end,
      duration: end - start,
    }
  })
}

function checkCommand(command, args = []) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  })

  return result.status === 0
}

function getWebpEncoder() {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    windowsHide: true,
  })

  if (result.status !== 0) {
    throw new Error(
        `无法读取 FFmpeg 编码器列表：${result.stderr || result.stdout}`,
    )
  }

  const output = `${result.stdout}\n${result.stderr}`

  // libwebp_anim 专门用于动画 WebP。
  if (/\blibwebp_anim\b/.test(output)) {
    return 'libwebp_anim'
  }

  // 某些 FFmpeg 构建使用 libwebp 输出动态 WebP。
  if (/\blibwebp\b/.test(output)) {
    return 'libwebp'
  }

  throw new Error(
      '当前 FFmpeg 未包含 libwebp_anim 或 libwebp 编码器，请安装带 libwebp 支持的 FFmpeg。',
  )
}

function buildFilter(ranges, fps) {
  const count = ranges.length
  const filters = []

  /*
   * 将输入复制为多路：
   * [0:v]split=3[source0][source1][source2]
   */
  const splitOutputs = ranges
      .map((_, index) => `[source${index}]`)
      .join('')

  filters.push(`[0:v]split=${count}${splitOutputs}`)

  /*
   * 对每一路分别裁剪，并重置时间戳。
   *
   * fps 用于统一不同片段的帧率，避免 concat 时出现
   * 时间基或帧率不一致。
   */
  ranges.forEach((range, index) => {
    filters.push(
        `[source${index}]` +
        `trim=start=${range.start}:end=${range.end},` +
        `setpts=PTS-STARTPTS,` +
        `fps=${fps},` +
        `format=yuva420p` +
        `[clip${index}]`,
    )
  })

  const concatInputs = ranges
      .map((_, index) => `[clip${index}]`)
      .join('')

  filters.push(
      `${concatInputs}concat=n=${count}:v=1:a=0[outv]`,
  )

  return filters.join(';')
}

function run() {
  let args

  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`参数错误：${error.message}`)
    printHelp()
    process.exit(1)
  }

  if (args.help) {
    printHelp()
    return
  }

  if (!args.input || !args.output) {
    console.error('必须指定输入文件和输出文件。')
    printHelp()
    process.exit(1)
  }

  if (!fs.existsSync(args.input)) {
    console.error(`输入文件不存在：${args.input}`)
    process.exit(1)
  }

  if (!Number.isFinite(args.fps) || args.fps <= 0 || args.fps > 120) {
    console.error('--fps 必须是 0 到 120 之间的数字。')
    process.exit(1)
  }

  if (
      !Number.isFinite(args.quality) ||
      args.quality < 0 ||
      args.quality > 100
  ) {
    console.error('--quality 必须是 0 到 100 之间的数字。')
    process.exit(1)
  }

  if (
      !Number.isInteger(args.loop) ||
      args.loop < 0
  ) {
    console.error('--loop 必须是大于或等于 0 的整数。')
    process.exit(1)
  }

  if (!checkCommand('ffmpeg', ['-version'])) {
    console.error(
        '未找到 FFmpeg。请先安装 FFmpeg，并确保 ffmpeg 命令已加入 PATH。',
    )
    process.exit(1)
  }

  let ranges

  try {
    ranges = parseRanges(args.ranges)
  } catch (error) {
    console.error(`时间段错误：${error.message}`)
    process.exit(1)
  }

  let encoder

  try {
    encoder = getWebpEncoder()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }

  const outputDir = path.dirname(path.resolve(args.output))
  fs.mkdirSync(outputDir, { recursive: true })

  const filterComplex = buildFilter(ranges, args.fps)

  const ffmpegArgs = [
    '-hide_banner',
    '-y',

    // animated WebP demuxer 对极短帧延迟可能进行限制，
    // 将最小有效帧延迟设为 1ms。
    '-min_delay',
    '1',

    '-i',
    args.input,

    '-filter_complex',
    filterComplex,

    '-map',
    '[outv]',

    '-an',
    '-c:v',
    encoder,

    '-loop',
    String(args.loop),

    '-quality',
    String(args.quality),

    '-lossless',
    args.lossless ? '1' : '0',

    '-compression_level',
    '6',

    args.output,
  ]

  console.log('开始处理动态 WebP：')

  ranges.forEach((range, index) => {
    console.log(
        `  ${index + 1}. ${range.start}s -> ${range.end}s，时长 ${range.duration}s`,
    )
  })

  console.log(`输出帧率：${args.fps} FPS`)
  console.log(`编码器：${encoder}`)
  console.log(`输出文件：${args.output}`)
  console.log('')

  const result = spawnSync('ffmpeg', ffmpegArgs, {
    stdio: 'inherit',
    windowsHide: true,
  })

  if (result.error) {
    console.error(`FFmpeg 启动失败：${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error(`处理失败，FFmpeg 退出码：${result.status}`)
    process.exit(result.status || 1)
  }

  if (!fs.existsSync(args.output)) {
    console.error('FFmpeg 已结束，但没有生成输出文件。')
    process.exit(1)
  }

  const size = fs.statSync(args.output).size

  console.log('')
  console.log('处理完成。')
  console.log(`文件：${path.resolve(args.output)}`)
  console.log(`大小：${(size / 1024 / 1024).toFixed(2)} MB`)
}

run()