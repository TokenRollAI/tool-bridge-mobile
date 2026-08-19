Pod::Spec.new do |s|
  s.name           = 'ToolBridgeAttention'
  s.version        = '1.0.0'
  s.summary        = 'Probe and emit foreground attention haptics'
  s.description    = 'Tool Bridge Mobile local native haptics boundary.'
  s.author         = 'TokenRollAI'
  s.homepage       = 'https://github.com/TokenRollAI/tool-bridge-mobile'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
