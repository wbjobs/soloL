//go:build linux

package handler

import (
	"encoding/json"
	"html/template"
	"net/http"
	"strconv"
	"syscall-tracer/store"
	"syscall-tracer/tracer"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	tracer *tracer.Tracer
	store  *store.Store
}

func NewHandler(t *tracer.Tracer, s *store.Store) *Handler {
	return &Handler{
		tracer: t,
		store:  s,
	}
}

func (h *Handler) RegisterRoutes(engine *gin.Engine) {
	trace := engine.Group("/trace")
	{
		trace.POST("/start", h.startTrace)
		trace.GET("/data", h.getTraceData)
		trace.POST("/stop", h.stopTrace)
		trace.GET("/aggregate", h.getAggregate)
		trace.GET("/flamegraph", h.getFlameGraph)
	}
}

func (h *Handler) startTrace(c *gin.Context) {
	var req struct {
		PID uint32 `json:"pid" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}

	if h.tracer.IsTracing() {
		c.JSON(http.StatusConflict, gin.H{
			"error":       "already tracing",
			"tracing_pid": h.tracer.TargetPID(),
			"trace_mode":  h.tracer.TraceMode(),
		})
		return
	}

	if err := h.tracer.StartTrace(req.PID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":     "tracing",
		"pid":        req.PID,
		"trace_mode": h.tracer.TraceMode(),
	})
}

func (h *Handler) getTraceData(c *gin.Context) {
	pidStr := c.Query("pid")

	var events []store.TraceEvent
	var err error

	if pidStr != "" {
		pid, parseErr := strconv.ParseUint(pidStr, 10, 32)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pid parameter"})
			return
		}
		events, err = h.store.QueryByPID(uint32(pid))
	} else {
		events, err = h.store.QueryAll()
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if events == nil {
		events = []store.TraceEvent{}
	}

	c.JSON(http.StatusOK, gin.H{
		"count":  len(events),
		"events": events,
	})
}

func (h *Handler) stopTrace(c *gin.Context) {
	if !h.tracer.IsTracing() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not currently tracing"})
		return
	}

	pid := h.tracer.TargetPID()
	if err := h.tracer.StopTrace(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      "stopped",
		"stopped_pid": pid,
	})
}

func (h *Handler) getAggregate(c *gin.Context) {
	timeRange := c.DefaultQuery("time_range", "last_5m")
	pidStr := c.Query("pid")

	since, err := store.ParseTimeRange(timeRange)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var pid uint32
	if pidStr != "" {
		p, parseErr := strconv.ParseUint(pidStr, 10, 32)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pid parameter"})
			return
		}
		pid = uint32(p)
	}

	results, err := h.store.AggregateByPIDAndSyscall(since, pid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if results == nil {
		results = []store.AggregateResult{}
	}

	c.JSON(http.StatusOK, gin.H{
		"time_range": timeRange,
		"count":      len(results),
		"aggregates": results,
	})
}

func (h *Handler) getFlameGraph(c *gin.Context) {
	timeRange := c.DefaultQuery("time_range", "last_5m")
	pidStr := c.Query("pid")
	format := c.DefaultQuery("format", "html")

	since, err := store.ParseTimeRange(timeRange)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var pid uint32
	if pidStr != "" {
		p, parseErr := strconv.ParseUint(pidStr, 10, 32)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pid parameter"})
			return
		}
		pid = uint32(p)
	}

	flameData, err := h.store.GenerateFlameGraph(since, pid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if format == "json" {
		c.JSON(http.StatusOK, flameData)
		return
	}

	jsonData, err := json.Marshal(flameData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Header("Content-Type", "text/html; charset=utf-8")
	tmpl, err := template.New("flamegraph").Parse(flameGraphTemplate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	tmpl.Execute(c.Writer, map[string]interface{}{
		"Data":      string(jsonData),
		"TimeRange": timeRange,
	})
}

const flameGraphTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>eBPF Syscall Flame Graph</title>
    <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/d3-flame-graph@4.1.3/dist/d3-flamegraph.css">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; }
        .header { margin-bottom: 20px; }
        .header h1 { margin: 0 0 10px 0; color: #333; }
        .stats { background: #f5f5f5; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
        .stats span { margin-right: 20px; font-weight: 600; }
        #chart { border: 1px solid #ddd; border-radius: 6px; padding: 10px; }
        .d3-flame-graph rect { stroke: #eee; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔥 eBPF Syscall Flame Graph</h1>
        <div class="stats">
            <span>Time Range: {{.TimeRange}}</span>
            <span>Generated by: syscall-tracer</span>
        </div>
    </div>
    <div id="chart"></div>
    <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/d3@7.8.5/dist/d3.min.js"></script>
    <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/d3-flame-graph@4.1.3/dist/d3-flamegraph.min.js"></script>
    <script type="text/javascript">
        var data = {{.Data}};
        var chart = flamegraph()
            .width(window.innerWidth - 60)
            .cellHeight(24)
            .transitionDuration(750)
            .minFrameSize(5)
            .sort(true)
            .title("Syscall Duration Distribution");
        d3.select("#chart")
            .datum(data)
            .call(chart);
    </script>
</body>
</html>`
