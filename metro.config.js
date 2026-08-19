import { getDefaultConfig } from 'expo/metro-config.js'
import { disableTypes } from 'image-size'

// Metro 不声明支持这些格式。禁用它们既缩小解析面，也为已打补丁的零长 box 防护增加纵深。
disableTypes(['heif', 'icns', 'jxl', 'jxl-stream'])

export default getDefaultConfig(import.meta.dirname)
