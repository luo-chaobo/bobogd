param(
  [string]$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe",
  [string]$ImageDirectory = "$PSScriptRoot\..\docs\architecture\images"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Escape-Xml([string]$Value) {
  return [System.Security.SecurityElement]::Escape($Value)
}

function Get-Style([System.Xml.XmlElement]$Cell) {
  $style = @{}
  foreach ($part in $Cell.GetAttribute('style').Split(';')) {
    $pair = $part.Split('=', 2)
    if ($pair.Length -eq 2) { $style[$pair[0]] = $pair[1] }
  }
  return $style
}

function Number([double]$Value) {
  return $Value.ToString('0.####', [System.Globalization.CultureInfo]::InvariantCulture)
}

function Replace-Output([string]$TemporaryPath, [string]$DestinationPath) {
  if ([System.IO.File]::Exists($DestinationPath)) {
    [System.IO.File]::Replace($TemporaryPath, $DestinationPath, [System.Management.Automation.Language.NullString]::Value)
  }
  else {
    [System.IO.File]::Move($TemporaryPath, $DestinationPath)
  }
}

# Supports this repository's flat nodes and explicit edge routes, not arbitrary mxGraph shapes.
function Export-ArchitectureSvg([string]$SourcePath, [string]$OutputPath) {
  $xml = [System.Xml.XmlDocument]::new()
  $xml.XmlResolver = $null
  $xml.Load($SourcePath)
  if ($xml.SelectNodes('/mxfile/diagram').Count -ne 1) { throw "Expected one diagram: $SourcePath" }
  $root = $xml.SelectSingleNode('/mxfile/diagram/mxGraphModel/root')
  if (-not $root -or -not $root.SelectSingleNode('mxCell[@id="0"]') -or -not $root.SelectSingleNode('mxCell[@id="1"]')) { throw "Invalid Draw.io root: $SourcePath" }
  $vertices = @($root.SelectNodes('mxCell[@vertex="1"]'))
  $edges = @($root.SelectNodes('mxCell[@edge="1"]'))
  $nodes = @{}
  foreach ($cell in $vertices) {
    if ($cell.GetAttribute('parent') -ne '1') { throw 'Nested vertices are not supported.' }
    $nodes[$cell.id] = $cell
  }
  $title = Escape-Xml $nodes['title'].value
  $description = Escape-Xml (($vertices | Where-Object { $_.id -notin @('title', 'legend', 'footer') } | ForEach-Object { $_.value -replace '<br\s*/?>', ' / ' }) -join '; ')
  $svg = [System.Text.StringBuilder]::new()
  [void]$svg.AppendLine('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-labelledby="title desc">')
  [void]$svg.AppendLine(('<title id="title">{0}</title><desc id="desc">{1}</desc><defs>' -f $title, $description))
  $colors = @($edges | ForEach-Object { (Get-Style $_)['strokeColor'] } | Sort-Object -Unique)
  foreach ($color in $colors) {
    if ($color -notmatch '^#[0-9A-Fa-f]{6}$') { throw "Unsupported edge color: $color" }
    [void]$svg.AppendLine(('<marker id="arrow-{0}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="{1}"/></marker>' -f $color.Substring(1), $color))
  }
  [void]$svg.AppendLine('<style>text{font-family:"Microsoft YaHei",Arial,sans-serif}.edge-label{paint-order:stroke;stroke:#F7FAFC;stroke-width:7;stroke-linejoin:round}</style></defs><rect width="1600" height="900" fill="#F7FAFC"/>')
  $orderedVertices = @($vertices | Where-Object { (Get-Style $_)['fillColor'] -eq 'none' }) + @($vertices | Where-Object { (Get-Style $_)['fillColor'] -ne 'none' })
  foreach ($cell in $orderedVertices) {
    $style = Get-Style $cell
    $geometry = $cell.SelectSingleNode('mxGeometry')
    $x = [double]$geometry.x; $y = [double]$geometry.y
    $width = [double]$geometry.width; $height = [double]$geometry.height
    $label = Escape-Xml ($cell.value -replace '<br\s*/?>', ' / ')
    [void]$svg.AppendLine(('<g id="node-{0}" aria-label="{1}">' -f $cell.id, $label))
    if ($style.ContainsKey('fillColor')) {
      $dash = if ($style['dashed'] -eq '1') { ' stroke-dasharray="9 7"' } else { '' }
      [void]$svg.AppendLine(('<rect x="{0}" y="{1}" width="{2}" height="{3}" rx="12" fill="{4}" stroke="{5}" stroke-width="2"{6}/>' -f (Number $x), (Number $y), (Number $width), (Number $height), $style['fillColor'], $style['strokeColor'], $dash))
    }
    $fontSize = [double]$style['fontSize']
    $lines = @($cell.value -split '<br\s*/?>')
    $lineHeight = $fontSize * 1.45
    $textY = $y + $height / 2 - ($lines.Count - 1) * $lineHeight / 2
    if ($style['verticalAlign'] -eq 'top') { $textY = $y + [double]$style['spacingTop'] + $fontSize / 2 }
    $textX = $x + $width / 2
    $anchor = 'middle'
    if ($style['align'] -eq 'left') { $textX = $x + [double]$style['spacingLeft']; $anchor = 'start' }
    if ($style['align'] -eq 'right') { $textX = $x + $width; $anchor = 'end' }
    $weight = if ($style['fontStyle'] -eq '1') { '700' } else { '400' }
    foreach ($line in $lines) {
      [void]$svg.AppendLine(('<text x="{0}" y="{1}" dominant-baseline="central" text-anchor="{2}" font-size="{3}" font-weight="{4}" fill="{5}">{6}</text>' -f (Number $textX), (Number $textY), $anchor, (Number $fontSize), $weight, $style['fontColor'], (Escape-Xml $line)))
      $textY += $lineHeight
    }
    [void]$svg.AppendLine('</g>')
  }
  foreach ($edge in $edges) {
    $style = Get-Style $edge
    foreach ($port in @('exitX', 'exitY', 'entryX', 'entryY')) {
      if (-not $style.ContainsKey($port)) { throw "Missing $port on $($edge.id)" }
    }
    if (-not $nodes.ContainsKey($edge.source) -or -not $nodes.ContainsKey($edge.target)) { throw "Unknown endpoint: $($edge.id)" }
    $source = $nodes[$edge.source].SelectSingleNode('mxGeometry')
    $target = $nodes[$edge.target].SelectSingleNode('mxGeometry')
    $points = [System.Collections.Generic.List[object]]::new()
    $points.Add(@(([double]$source.x + [double]$source.width * [double]$style['exitX']), ([double]$source.y + [double]$source.height * [double]$style['exitY'])))
    foreach ($point in $edge.SelectNodes('mxGeometry/Array[@as="points"]/mxPoint')) { $points.Add(@([double]$point.x, [double]$point.y)) }
    $points.Add(@(([double]$target.x + [double]$target.width * [double]$style['entryX']), ([double]$target.y + [double]$target.height * [double]$style['entryY'])))
    $path = 'M' + (($points | ForEach-Object { (Number $_[0]) + ' ' + (Number $_[1]) }) -join ' L')
    $color = $style['strokeColor']
    $label = Escape-Xml $edge.value
    [void]$svg.AppendLine(('<g id="edge-{0}" aria-label="{1}"><path d="{2}" fill="none" stroke="{3}" stroke-width="2.5" marker-end="url(#arrow-{4})"/>' -f $edge.id, $label, $path, $color, $color.Substring(1)))
    $lengths = @()
    for ($i = 1; $i -lt $points.Count; $i++) {
      $lengths += [Math]::Sqrt([Math]::Pow($points[$i][0] - $points[$i - 1][0], 2) + [Math]::Pow($points[$i][1] - $points[$i - 1][1], 2))
    }
    $remaining = ($lengths | Measure-Object -Sum).Sum / 2
    for ($i = 0; $i -lt $lengths.Count; $i++) {
      if ($lengths[$i] -gt 0 -and $remaining -le $lengths[$i]) {
        $ratio = $remaining / $lengths[$i]
        $labelX = $points[$i][0] + $ratio * ($points[$i + 1][0] - $points[$i][0])
        $labelY = $points[$i][1] + $ratio * ($points[$i + 1][1] - $points[$i][1])
        break
      }
      $remaining -= $lengths[$i]
    }
    $offset = $edge.SelectSingleNode('mxGeometry/mxPoint[@as="offset"]')
    if ($offset) { $labelX += [double]$offset.x; $labelY += [double]$offset.y }
    [void]$svg.AppendLine(('<text class="edge-label" x="{0}" y="{1}" dominant-baseline="central" text-anchor="middle" font-size="{2}" fill="#334E68">{3}</text></g>' -f (Number $labelX), (Number $labelY), $style['fontSize'], $label))
  }
  [void]$svg.AppendLine('</svg>')
  [System.IO.File]::WriteAllText($OutputPath, $svg.ToString(), [System.Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path -LiteralPath $ChromePath -PathType Leaf)) { throw "Chrome not found: $ChromePath" }
$resolvedImageDirectory = (Resolve-Path -LiteralPath $ImageDirectory).Path
$sourceDirectory = Join-Path (Split-Path -Parent $resolvedImageDirectory) 'sources'
$sources = @(Get-ChildItem -LiteralPath $sourceDirectory -Filter '*.drawio' -File | Sort-Object Name)
if ($sources.Count -eq 0) { throw "No Draw.io sources: $sourceDirectory" }
$temporaryRoot = Join-Path $resolvedImageDirectory ('.render-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  foreach ($source in $sources) {
    $svgPath = Join-Path $resolvedImageDirectory ($source.BaseName + '.svg')
    $temporarySvg = Join-Path $temporaryRoot ($source.BaseName + '.svg')
    $temporaryPng = Join-Path $temporaryRoot ($source.BaseName + '.png')
    Export-ArchitectureSvg $source.FullName $temporarySvg
    $arguments = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1600,900', '--force-device-scale-factor=1', "--user-data-dir=$temporaryRoot\chrome", "--screenshot=$temporaryPng", [System.Uri]::new($temporarySvg).AbsoluteUri)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Resolve-Path -LiteralPath $ChromePath).Path
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    # Windows argument quoting preserves spaces, quotes and trailing backslashes.
    $startInfo.Arguments = ($arguments | ForEach-Object { '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }) -join ' '
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $process.WaitForExit()
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $temporaryPng -PathType Leaf) -or (Get-Item -LiteralPath $temporaryPng).Length -eq 0) { throw "Chrome render failed: $($source.Name)" }
    $image = [System.Drawing.Image]::FromFile($temporaryPng)
    try {
      if ($image.Width -ne 1600 -or $image.Height -ne 900) { throw "Invalid PNG size: $($image.Width)x$($image.Height)" }
    }
    finally { $image.Dispose() }
    Replace-Output $temporarySvg $svgPath
    Replace-Output $temporaryPng (Join-Path $resolvedImageDirectory ($source.BaseName + '.png'))
    Write-Output "EXPORTED AND RENDERED $($source.BaseName) 1600x900"
  }
}
finally {
  $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
  if ((Split-Path -Parent $resolvedTemporaryRoot) -ne $resolvedImageDirectory -or (Split-Path -Leaf $resolvedTemporaryRoot) -notmatch '^\.render-[a-f0-9]{32}$') { throw 'Unsafe temporary cleanup path.' }
  Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
