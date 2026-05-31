package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"text/tabwriter"
	"time"

	"dbdoctor/internal/cockroach"
	"dbdoctor/internal/report"

	"github.com/spf13/cobra"
)

var (
	diagDuration    int
	diagSlowThreshold float64
	diagOutput      string
	diagNoCollect   bool
)

var diagnoseCmd = &cobra.Command{
	Use:   "diagnose",
	Short: "性能诊断：采集QPS、P99延迟、慢查询，生成优化建议",
	Long: `自动采集集群性能指标，分析后给出优化建议。

采集内容:
  - 30秒内的QPS、P99/P50延迟时序数据
  - 慢查询日志（执行时间>100ms）
  - 表统计信息（行数、索引数、tombstone数量）

分析建议:
  - 缺少二级索引的表
  - tombstone过多需手动GC
  - P99延迟过高
  - Range不可用/复制不足

输出格式:
  - 终端表格（默认）
  - JSON (--json)
  - HTML可视化报告 (--output report.html)`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := loadConfig()
		if err != nil {
			return err
		}

		cluster, err := getCluster(cfg)
		if err != nil {
			return err
		}

		sqlClient, err := cockroach.NewSQLClient(cluster)
		if err != nil {
			return fmt.Errorf("failed to connect to SQL: %w", err)
		}
		defer sqlClient.Close()

		fmt.Println("🔍 CockroachDB 性能诊断")
		fmt.Printf("集群: %s (%s:%d)\n", cluster.Name, cluster.SQLHost, cluster.SQLPort)
		fmt.Printf("采集时长: %d秒 | 慢查询阈值: %.0fms\n\n", diagDuration, diagSlowThreshold)

		progressCallback := func(msg string) {
			fmt.Printf("  ⏳ %s\n", msg)
		}

		var result *cockroach.DiagnosticResult

		if !diagNoCollect {
			result, err = sqlClient.RunDiagnostics(diagDuration, diagSlowThreshold, progressCallback)
			if err != nil {
				return fmt.Errorf("diagnostics failed: %w", err)
			}
		} else {
			result = &cockroach.DiagnosticResult{
				StartTime:      time.Now(),
				EndTime:        time.Now(),
				DurationSeconds: diagDuration,
				Snapshots:      []cockroach.DiagnosticSnapshot{},
				SlowQueries:    []cockroach.SlowQueryInfo{},
				TableStats:     []cockroach.TableStatInfo{},
				Recommendations: []cockroach.Recommendation{},
			}
		}

		result.ClusterName = cluster.Name

		if diagOutput != "" {
			return generateHTMLReport(result)
		}

		if jsonOutput {
			data, err := json.MarshalIndent(result, "", "  ")
			if err != nil {
				return err
			}
			fmt.Println(string(data))
			return nil
		}

		printDiagnosticResult(result)
		return nil
	},
}

func printDiagnosticResult(result *cockroach.DiagnosticResult) {
	fmt.Println("\n╔══════════════════════════════════════════════════════════╗")
	fmt.Println("║              性能诊断报告                                ║")
	fmt.Println("╚══════════════════════════════════════════════════════════╝")

	fmt.Println("\n=== 概览 ===")
	fmt.Printf("  采集时间: %s ~ %s (%ds)\n",
		result.StartTime.Format(time.RFC3339),
		result.EndTime.Format(time.RFC3339),
		result.DurationSeconds)
	fmt.Printf("  平均 QPS: %.1f\n", result.SummaryQPS)
	fmt.Printf("  P99 延迟: %.1fms\n", result.SummaryP99Ms)
	fmt.Printf("  慢查询数: %d (阈值 %.0fms)\n", result.SummarySlowCount, diagSlowThreshold)

	if len(result.Snapshots) > 0 {
		fmt.Println("\n=== 时序指标 ===")
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "时间\tQPS\tP99(ms)\t活跃查询\t慢查询\t不可用Range")
		for _, snap := range result.Snapshots {
			fmt.Fprintf(w, "%s\t%.1f\t%.1f\t%d\t%d\t%d\n",
				snap.Timestamp.Format("15:04:05"),
				snap.QPS,
				snap.P99LatencyMs,
				snap.ActiveQueries,
				snap.SlowQueries,
				snap.UnavailableRanges,
			)
		}
		w.Flush()
	}

	if len(result.SlowQueries) > 0 {
		fmt.Println("\n=== 慢查询 (Top 20) ===")
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "执行时间(ms)\t数据库\t状态\t查询")
		limit := 20
		if len(result.SlowQueries) < limit {
			limit = len(result.SlowQueries)
		}
		for i := 0; i < limit; i++ {
			sq := result.SlowQueries[i]
			query := sq.Query
			if len(query) > 80 {
				query = query[:80] + "..."
			}
			fmt.Fprintf(w, "%.1f\t%s\t%s\t%s\n", sq.DurationMs, sq.Database, sq.Status, query)
		}
		w.Flush()
	}

	if len(result.TableStats) > 0 {
		fmt.Println("\n=== 表统计 ===")
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "表名\t行数\t索引数\tTombstone\tRange\t主键")
		for _, ts := range result.TableStats {
			pk := "❌"
			if ts.HasPrimaryKey {
				pk = "✅"
			}
			fmt.Fprintf(w, "%s\t%d\t%d\t%d\t%d\t%s\n",
				ts.TableName, ts.RowCount, ts.IndexCount,
				ts.TombstoneCount, ts.RangeCount, pk)
		}
		w.Flush()
	}

	if len(result.Recommendations) > 0 {
		fmt.Println("\n=== 💡 诊断建议 ===")
		for i, rec := range result.Recommendations {
			icon := "🔵"
			if rec.Severity == "critical" {
				icon = "🔴"
			} else if rec.Severity == "high" {
				icon = "🟠"
			} else if rec.Severity == "medium" {
				icon = "🟡"
			}

			fmt.Printf("\n%s [%s] %s\n", icon, rec.Category, rec.Title)
			fmt.Printf("   详情: %s\n", rec.Detail)
			fmt.Printf("   建议: %s\n", rec.Action)

			if i >= 19 {
				fmt.Printf("\n   ... 还有 %d 条建议\n", len(result.Recommendations)-20)
				break
			}
		}
	} else {
		fmt.Println("\n✅ 未发现性能问题")
	}

	fmt.Println("\n💡 使用 --output report.html 生成可视化报告（含时序图表和火焰图）")
}

func generateHTMLReport(result *cockroach.DiagnosticResult) error {
	outputPath := diagOutput
	if !filepath.IsAbs(outputPath) {
		abs, err := os.Getwd()
		if err == nil {
			outputPath = filepath.Join(abs, outputPath)
		}
	}

	fmt.Printf("📊 生成HTML可视化报告...\n")

	if err := report.GenerateHTMLReport(result, outputPath); err != nil {
		return fmt.Errorf("failed to generate HTML report: %w", err)
	}

	fmt.Printf("✅ 报告已生成: %s\n", outputPath)
	fmt.Println("   用浏览器打开查看时序指标图表和慢查询火焰图")

	return nil
}

func init() {
	diagnoseCmd.Flags().IntVarP(&diagDuration, "duration", "d", 30, "diagnostics collection duration in seconds")
	diagnoseCmd.Flags().Float64Var(&diagSlowThreshold, "slow-threshold", 100, "slow query threshold in milliseconds")
	diagnoseCmd.Flags().StringVarP(&diagOutput, "output", "o", "", "output HTML report to file (e.g., report.html)")
	diagnoseCmd.Flags().BoolVar(&diagNoCollect, "no-collect", false, "skip data collection (for report generation only)")
	rootCmd.AddCommand(diagnoseCmd)
}
