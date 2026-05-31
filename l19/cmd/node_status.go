package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	"dbdoctor/internal/cockroach"
	"dbdoctor/internal/health"

	"github.com/spf13/cobra"
)

var (
	showDetails bool
	withHealth  bool
)

var nodeStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "显示集群节点状态",
	Long:  "展示节点详情、存活状态、副本数、leaseholder等信息",
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

		nodes, err := sqlClient.GetNodeDetails()
		if err != nil {
			return fmt.Errorf("failed to get node details: %w", err)
		}

		var healthReport *health.HealthReport
		if withHealth {
			httpClient := cockroach.NewHTTPClient(cluster)
			checker := health.NewHealthChecker(&cfg.HealthCheck, httpClient, sqlClient)
			healthReport, err = checker.CheckAllNodes()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Warning: health check failed: %v\n", err)
			}
		}

		if jsonOutput {
			return printJSON(nodes, healthReport)
		}

		return printTable(nodes, healthReport, showDetails)
	},
}

func printTable(nodes []cockroach.NodeDetail, report *health.HealthReport, showDetails bool) error {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)

	if report != nil {
		fmt.Println("=== 集群健康检查 ===")
		fmt.Printf("总节点数: %d | 健康节点: %d | 不可用节点: %d\n",
			report.TotalNodes, report.HealthyNodes, report.UnavailableNodes)
		if report.NetworkPartition {
			fmt.Printf("⚠️  检测到网络分区! 分区节点: %v\n", report.PartitionedNodes)
		}
		fmt.Println()
	}

	fmt.Println("=== 节点状态 ===")
	headers := "节点ID\t地址\t存活\t副本数(活跃/总数)\tLeaseholders\tRanges\t不可用Ranges\t版本\t启动时间"
	if showDetails {
		headers += "\t复制不足\tSQL地址"
	}
	if report != nil {
		headers += "\t心跳状态\t连续失败"
	}
	fmt.Fprintln(w, headers)

	for _, node := range nodes {
		alive := "✅"
		if !node.Alive {
			alive = "❌"
		}

		row := fmt.Sprintf("%d\t%s\t%s\t%d/%d\t%d\t%d\t%d\t%s\t%s",
			node.NodeID,
			node.Address,
			alive,
			node.LiveReplicas,
			node.TotalReplicas,
			node.Leaseholders,
			node.Ranges,
			node.Unavailable,
			node.BuildTag,
			formatUptime(node.StartedAt),
		)

		if showDetails {
			row += fmt.Sprintf("\t%d\t%s", node.UnderReplicated, node.SQLAddress)
		}

		if report != nil {
			healthStatus := findNodeHealth(report, node.NodeID)
			if healthStatus != nil {
				status := "✅"
				if healthStatus.Status == "degraded" {
					status = "⚠️"
				} else if healthStatus.Status == "unavailable" {
					status = "❌"
				}
				row += fmt.Sprintf("\t%s\t%d", status, healthStatus.ConsecutiveFails)
			} else {
				row += "\t-\t-"
			}
		}

		fmt.Fprintln(w, row)
	}

	w.Flush()

	if showDetails {
		fmt.Println("\n=== 节点详情 ===")
		for _, node := range nodes {
			fmt.Printf("\n--- Node %d (%s) ---\n", node.NodeID, node.Address)
			fmt.Printf("  SQL地址: %s\n", node.SQLAddress)
			fmt.Printf("  版本: %s\n", node.BuildTag)
			fmt.Printf("  启动时间: %s\n", node.StartedAt.Format(time.RFC3339))
			fmt.Printf("  运行时间: %s\n", formatUptime(node.StartedAt))
			fmt.Printf("  存活状态: %t\n", node.Alive)
			fmt.Printf("  总副本数: %d (活跃: %d)\n", node.TotalReplicas, node.LiveReplicas)
			fmt.Printf("  Leaseholders: %d\n", node.Leaseholders)
			fmt.Printf("  Ranges: %d (不可用: %d, 复制不足: %d)\n",
				node.Ranges, node.Unavailable, node.UnderReplicated)
		}
	}

	return nil
}

func printJSON(nodes []cockroach.NodeDetail, report *health.HealthReport) error {
	output := make(map[string]interface{})
	output["nodes"] = nodes
	output["timestamp"] = time.Now().Format(time.RFC3339)

	if report != nil {
		output["health"] = report
	}

	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		return err
	}

	fmt.Println(string(data))
	return nil
}

func findNodeHealth(report *health.HealthReport, nodeID int) *health.NodeHealthStatus {
	if report == nil {
		return nil
	}
	for i := range report.Nodes {
		if report.Nodes[i].NodeID == nodeID {
			return &report.Nodes[i]
		}
	}
	return nil
}

func formatUptime(start time.Time) string {
	uptime := time.Since(start)
	days := int(uptime.Hours() / 24)
	hours := int(uptime.Hours()) % 24
	minutes := int(uptime.Minutes()) % 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	} else if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}

func init() {
	nodeStatusCmd.Flags().BoolVarP(&showDetails, "details", "d", false, "show detailed node information")
	nodeStatusCmd.Flags().BoolVarP(&withHealth, "health", "H", false, "include heartbeat health check")
	nodeCmd.AddCommand(nodeStatusCmd)
}
