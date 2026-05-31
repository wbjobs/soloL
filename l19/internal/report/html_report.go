package report

import (
	"encoding/json"
	"fmt"
	"html/template"
	"os"
	"strings"
	"time"

	"dbdoctor/internal/cockroach"
)

type HTMLReportData struct {
	ClusterName     string
	StartTime       string
	EndTime         string
	Duration        int
	SummaryQPS      float64
	SummaryP99      float64
	SlowQueryCount  int
	SnapshotsJSON   template.JS
	SlowQueriesJSON template.JS
	TableStatsJSON  template.JS
	RecsJSON        template.JS
	Recommendations []cockroach.Recommendation
	SlowQueries     []cockroach.SlowQueryInfo
	TableStats      []cockroach.TableStatInfo
}

func GenerateHTMLReport(result *cockroach.DiagnosticResult, outputPath string) error {
	data := HTMLReportData{
		ClusterName:    result.ClusterName,
		StartTime:      result.StartTime.Format(time.RFC3339),
		EndTime:        result.EndTime.Format(time.RFC3339),
		Duration:       result.DurationSeconds,
		SummaryQPS:     result.SummaryQPS,
		SummaryP99:     result.SummaryP99Ms,
		SlowQueryCount: result.SummarySlowCount,
		Recommendations: result.Recommendations,
		SlowQueries:     result.SlowQueries,
		TableStats:      result.TableStats,
	}

	snapBytes, _ := json.Marshal(result.Snapshots)
	data.SnapshotsJSON = template.JS(string(snapBytes))

	sqBytes, _ := json.Marshal(result.SlowQueries)
	data.SlowQueriesJSON = template.JS(string(sqBytes))

	tsBytes, _ := json.Marshal(result.TableStats)
	data.TableStatsJSON = template.JS(string(tsBytes))

	recBytes, _ := json.Marshal(result.Recommendations)
	data.RecsJSON = template.JS(string(recBytes))

	tmpl := template.Must(template.New("report").Parse(htmlTemplate))

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("failed to create report file: %w", err)
	}
	defer f.Close()

	if err := tmpl.Execute(f, data); err != nil {
		return fmt.Errorf("failed to execute template: %w", err)
	}

	return nil
}

func severityIcon(sev string) string {
	switch sev {
	case "critical":
		return "🔴"
	case "high":
		return "🟠"
	case "medium":
		return "🟡"
	default:
		return "🔵"
	}
}

func escapeHTML(s string) string {
	return strings.ReplaceAll(template.HTMLEscapeString(s), "\n", "<br>")
}

var htmlTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>dbdoctor 性能诊断报告 - {{.ClusterName}}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.6}
.container{max-width:1400px;margin:0 auto;padding:24px}
header{background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:16px;padding:32px;margin-bottom:24px}
header h1{font-size:28px;background:linear-gradient(90deg,#38bdf8,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
header .meta{color:#94a3b8;margin-top:8px;font-size:14px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px}
.card .label{color:#94a3b8;font-size:13px;text-transform:uppercase;letter-spacing:0.5px}
.card .value{font-size:32px;font-weight:700;margin-top:4px}
.card .value.qps{color:#38bdf8}
.card .value.p99{color:#f59e0b}
.card .value.slow{color:#ef4444}
.card .value.ranges{color:#a78bfa}
.card .value.nodes{color:#34d399}
.section{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:24px}
.section h2{font-size:20px;margin-bottom:16px;color:#f1f5f9;display:flex;align-items:center;gap:8px}
.chart-container{position:relative;height:350px;background:#0f172a;border-radius:8px;padding:16px;margin-bottom:16px}
canvas{width:100%!important;height:100%!important}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;padding:10px 12px;background:#0f172a;color:#94a3b8;font-weight:600;border-bottom:1px solid #334155}
td{padding:10px 12px;border-bottom:1px solid #1e293b}
tr:hover td{background:#1e293b}
.severity-critical{color:#ef4444;font-weight:700}
.severity-high{color:#f97316;font-weight:700}
.severity-medium{color:#eab308;font-weight:700}
.severity-low{color:#3b82f6}
.badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600}
.badge-critical{background:#7f1d1d;color:#fca5a5}
.badge-high{background:#7c2d12;color:#fdba74}
.badge-medium{background:#713f12;color:#fde047}
.badge-low{background:#1e3a5f;color:#93c5fd}
.flame-container{height:200px;background:#0f172a;border-radius:8px;overflow:auto;padding:8px}
.flame-bar{display:flex;align-items:center;height:32px;margin-bottom:2px;border-radius:4px;padding:0 8px;font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:opacity 0.2s}
.flame-bar:hover{opacity:0.8}
.footer{text-align:center;color:#475569;font-size:12px;padding:24px 0}
</style>
</head>
<body>
<div class="container">
<header>
<h1>dbdoctor 性能诊断报告</h1>
<div class="meta">集群: {{.ClusterName}} | 采集时间: {{.StartTime}} ~ {{.EndTime}} | 持续: {{.Duration}}秒</div>
</header>

<div class="cards">
<div class="card">
<div class="label">QPS (每秒查询数)</div>
<div class="value qps">{{printf "%.1f" .SummaryQPS}}</div>
</div>
<div class="card">
<div class="label">P99 延迟</div>
<div class="value p99">{{printf "%.1f" .SummaryP99}}ms</div>
</div>
<div class="card">
<div class="label">慢查询数 (>100ms)</div>
<div class="value slow">{{.SlowQueryCount}}</div>
</div>
<div class="card">
<div class="label">建议数</div>
<div class="value" style="color:#c084fc">{{len .Recommendations}}</div>
</div>
</div>

<div class="section">
<h2>📊 时序指标</h2>
<div class="chart-container">
<canvas id="metricsChart"></canvas>
</div>
</div>

<div class="section">
<h2>🔥 慢查询火焰图</h2>
<div class="flame-container" id="flameChart"></div>
</div>

<div class="section">
<h2>💡 诊断建议</h2>
<table>
<thead>
<tr><th>级别</th><th>类别</th><th>标题</th><th>详情</th><th>操作建议</th></tr>
</thead>
<tbody id="recsBody"></tbody>
</table>
</div>

<div class="section">
<h2>🐢 慢查询详情</h2>
<table>
<thead>
<tr><th>执行时间</th><th>数据库</th><th>查询</th><th>状态</th><th>重试</th></tr>
</thead>
<tbody id="slowBody"></tbody>
</table>
</div>

<div class="section">
<h2>📋 表统计</h2>
<table>
<thead>
<tr><th>表名</th><th>行数</th><th>索引数</th><th>Tombstone</th><th>Range数</th><th>主键</th></tr>
</thead>
<tbody id="tableBody"></tbody>
</table>
</div>

<div class="footer">Generated by dbdoctor v1.0.0 | {{.EndTime}}</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
(function(){
var snapshots = {{.SnapshotsJSON}};
var slowQueries = {{.SlowQueriesJSON}};
var tableStats = {{.TableStatsJSON}};
var recommendations = {{.RecsJSON}};

function renderMetricsChart(){
  var ctx = document.getElementById('metricsChart').getContext('2d');
  var labels = snapshots.map(function(s){return new Date(s.timestamp).toLocaleTimeString()});
  var qpsData = snapshots.map(function(s){return s.qps});
  var p99Data = snapshots.map(function(s){return s.p99_latency_ms});
  var slowData = snapshots.map(function(s){return s.slow_queries});
  var rangeData = snapshots.map(function(s){return s.unavailable_ranges});

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {label:'QPS',data:qpsData,borderColor:'#38bdf8',backgroundColor:'rgba(56,189,248,0.1)',fill:true,yAxisID:'y',tension:0.3},
        {label:'P99延迟(ms)',data:p99Data,borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,0.1)',fill:true,yAxisID:'y1',tension:0.3},
        {label:'慢查询数',data:slowData,borderColor:'#ef4444',backgroundColor:'rgba(239,68,68,0.1)',fill:false,yAxisID:'y',tension:0.3},
        {label:'不可用Range',data:rangeData,borderColor:'#a78bfa',backgroundColor:'rgba(167,139,250,0.1)',fill:false,yAxisID:'y',tension:0.3}
      ]
    },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:'#94a3b8'}}},
      scales:{
        x:{ticks:{color:'#64748b'},grid:{color:'#1e293b'}},
        y:{type:'linear',position:'left',ticks:{color:'#38bdf8'},grid:{color:'#1e293b'},title:{display:true,text:'QPS / 慢查询 / Range',color:'#94a3b8'}},
        y1:{type:'linear',position:'right',ticks:{color:'#f59e0b'},grid:{drawOnChartArea:false},title:{display:true,text:'P99延迟 (ms)',color:'#94a3b8'}}
      }
    }
  });
}

function renderFlameChart(){
  var container = document.getElementById('flameChart');
  if(!slowQueries || slowQueries.length === 0){
    container.innerHTML = '<div style="color:#94a3b8;padding:20px;text-align:center">没有慢查询数据</div>';
    return;
  }
  var maxDur = 0;
  slowQueries.forEach(function(sq){if(sq.duration_ms > maxDur) maxDur = sq.duration_ms});

  var colors = ['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#14b8a6','#06b6d4','#3b82f6','#8b5cf6'];

  slowQueries.forEach(function(sq, i){
    var widthPct = Math.max((sq.duration_ms / maxDur) * 100, 5);
    var bar = document.createElement('div');
    bar.className = 'flame-bar';
    bar.style.width = widthPct + '%';
    bar.style.backgroundColor = colors[i % colors.length];
    bar.title = sq.database + ' | ' + sq.duration_ms.toFixed(1) + 'ms\n' + sq.query;
    bar.textContent = sq.duration_ms.toFixed(1) + 'ms - ' + truncate(sq.query, 60);
    container.appendChild(bar);
  });

  function truncate(s, n){return s.length > n ? s.substring(0, n) + '...' : s}
}

function renderRecommendations(){
  var tbody = document.getElementById('recsBody');
  if(!recommendations || recommendations.length === 0){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8">没有诊断建议</td></tr>';
    return;
  }
  recommendations.forEach(function(r){
    var sevClass = 'severity-' + r.severity;
    var badgeClass = 'badge badge-' + r.severity;
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><span class="'+badgeClass+'">'+r.severity.toUpperCase()+'</span></td>' +
      '<td>'+r.category+'</td>' +
      '<td class="'+sevClass+'">'+r.title+'</td>' +
      '<td>'+r.detail+'</td>' +
      '<td>'+r.action+'</td>';
    tbody.appendChild(tr);
  });
}

function renderSlowQueries(){
  var tbody = document.getElementById('slowBody');
  if(!slowQueries || slowQueries.length === 0){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8">没有慢查询</td></tr>';
    return;
  }
  slowQueries.forEach(function(sq){
    var tr = document.createElement('tr');
    var durColor = sq.duration_ms > 1000 ? '#ef4444' : sq.duration_ms > 500 ? '#f97316' : '#f59e0b';
    tr.innerHTML = '<td style="color:'+durColor+';font-weight:600">'+sq.duration_ms.toFixed(1)+'ms</td>' +
      '<td>'+sq.database+'</td>' +
      '<td style="font-family:monospace;font-size:12px;max-width:500px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+sq.query.replace(/"/g,'&quot;')+'">'+sq.query.substring(0,120)+'</td>' +
      '<td>'+sq.status+'</td>' +
      '<td>'+sq.retries+'</td>';
    tbody.appendChild(tr);
  });
}

function renderTableStats(){
  var tbody = document.getElementById('tableBody');
  if(!tableStats || tableStats.length === 0){
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8">没有表统计数据</td></tr>';
    return;
  }
  tableStats.forEach(function(ts){
    var pkIcon = ts.has_primary_key ? '✅' : '❌';
    var tombColor = ts.tombstone_count > ts.row_count/10 ? '#ef4444' : '#94a3b8';
    var idxColor = ts.index_count === 0 && ts.row_count > 10000 ? '#ef4444' : '#94a3b8';
    var tr = document.createElement('tr');
    tr.innerHTML = '<td style="font-weight:600">'+ts.table_name+'</td>' +
      '<td>'+ts.row_count.toLocaleString()+'</td>' +
      '<td style="color:'+idxColor+'">'+ts.index_count+'</td>' +
      '<td style="color:'+tombColor+'">'+ts.tombstone_count.toLocaleString()+'</td>' +
      '<td>'+ts.range_count+'</td>' +
      '<td>'+pkIcon+'</td>';
    tbody.appendChild(tr);
  });
}

renderMetricsChart();
renderFlameChart();
renderRecommendations();
renderSlowQueries();
renderTableStats();
})();
</script>
</body>
</html>`