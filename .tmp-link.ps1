param([int]$n)
$wt = "C:\GitRepos\squads-demo-$n"
$main = "C:\GitRepos\squads-demo"
foreach ($p in @("node_modules","apps\web\node_modules","apps\worker\node_modules","packages\schema\node_modules","packages\rules\node_modules","packages\assets-meta\node_modules")) {
  $src = Join-Path $main $p
  $dst = Join-Path $wt $p
  if ((Test-Path $src) -and -not (Test-Path $dst)) {
    cmd /c "mklink /J `"$dst`" `"$src`"" 2>&1 | Out-Null
  }
}
