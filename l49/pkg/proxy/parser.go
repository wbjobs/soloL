package proxy

import (
	"regexp"
	"strings"
)

type QueryType int

const (
	QueryUnknown QueryType = iota
	QuerySelect
	QueryInsert
	QueryUpdate
	QueryDelete
)

type ParsedQuery struct {
	Type      QueryType
	TableName string
	Schema    string
	Columns   []string
	Values    [][]string
	Where     map[string]string
	Raw       string
}

type SQLParser struct {
	insertRegex *regexp.Regexp
	selectRegex *regexp.Regexp
	updateRegex *regexp.Regexp
}

func NewSQLParser() *SQLParser {
	return &SQLParser{
		insertRegex: regexp.MustCompile(`(?i)INSERT\s+INTO\s+(?:([` + "`" + `"\w]+)\.)?([` + "`" + `"\w]+)\s*\(([^)]+)\)\s*VALUES\s*(.+)`),
		selectRegex: regexp.MustCompile(`(?i)SELECT\s+(.+?)\s+FROM\s+(?:([` + "`" + `"\w]+)\.)?([` + "`" + `"\w]+)(?:\s+WHERE\s+(.+))?`),
		updateRegex: regexp.MustCompile(`(?i)UPDATE\s+(?:([` + "`" + `"\w]+)\.)?([` + "`" + `"\w]+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$`),
	}
}

func (p *SQLParser) Parse(sql string) *ParsedQuery {
	sql = strings.TrimSpace(sql)

	if strings.HasPrefix(strings.ToUpper(sql), "INSERT") {
		return p.parseInsert(sql)
	} else if strings.HasPrefix(strings.ToUpper(sql), "SELECT") {
		return p.parseSelect(sql)
	} else if strings.HasPrefix(strings.ToUpper(sql), "UPDATE") {
		return p.parseUpdate(sql)
	}

	return &ParsedQuery{Type: QueryUnknown, Raw: sql}
}

func (p *SQLParser) parseInsert(sql string) *ParsedQuery {
	matches := p.insertRegex.FindStringSubmatch(sql)
	if len(matches) < 5 {
		return &ParsedQuery{Type: QueryUnknown, Raw: sql}
	}

	schema := strings.Trim(matches[1], "`\"")
	table := strings.Trim(matches[2], "`\"")
	columnsStr := matches[3]
	valuesStr := matches[4]

	columns := parseColumnList(columnsStr)
	values := parseValues(valuesStr)

	return &ParsedQuery{
		Type:      QueryInsert,
		Schema:    schema,
		TableName: table,
		Columns:   columns,
		Values:    values,
		Raw:       sql,
	}
}

func (p *SQLParser) parseSelect(sql string) *ParsedQuery {
	matches := p.selectRegex.FindStringSubmatch(sql)
	if len(matches) < 4 {
		return &ParsedQuery{Type: QueryUnknown, Raw: sql}
	}

	columnsStr := matches[1]
	schema := strings.Trim(matches[2], "`\"")
	table := strings.Trim(matches[3], "`\"")
	whereStr := matches[4]

	columns := parseColumnList(columnsStr)
	where := parseWhere(whereStr)

	return &ParsedQuery{
		Type:      QuerySelect,
		Schema:    schema,
		TableName: table,
		Columns:   columns,
		Where:     where,
		Raw:       sql,
	}
}

func (p *SQLParser) parseUpdate(sql string) *ParsedQuery {
	matches := p.updateRegex.FindStringSubmatch(sql)
	if len(matches) < 4 {
		return &ParsedQuery{Type: QueryUnknown, Raw: sql}
	}

	schema := strings.Trim(matches[1], "`\"")
	table := strings.Trim(matches[2], "`\"")
	setStr := matches[3]
	whereStr := matches[4]

	setPairs := parseSetClauses(setStr)
	columns := make([]string, 0, len(setPairs))
	values := make([][]string, 1)
	values[0] = make([]string, 0, len(setPairs))

	for col, val := range setPairs {
		columns = append(columns, col)
		values[0] = append(values[0], val)
	}

	where := parseWhere(whereStr)

	return &ParsedQuery{
		Type:      QueryUpdate,
		Schema:    schema,
		TableName: table,
		Columns:   columns,
		Values:    values,
		Where:     where,
		Raw:       sql,
	}
}

func parseColumnList(str string) []string {
	parts := strings.Split(str, ",")
	columns := make([]string, len(parts))
	for i, part := range parts {
		columns[i] = strings.TrimSpace(strings.Trim(part, "`\" "))
	}
	return columns
}

func parseValues(str string) [][]string {
	var result [][]string
	
	valueGroups := regexp.MustCompile(`\(([^)]+)\)`).FindAllStringSubmatch(str, -1)
	for _, group := range valueGroups {
		if len(group) > 1 {
			values := splitValues(group[1])
			result = append(result, values)
		}
	}
	
	return result
}

func splitValues(str string) []string {
	var values []string
	var current strings.Builder
	inQuote := false
	quoteChar := rune(0)
	
	for _, r := range str {
		switch {
		case !inQuote && (r == '\'' || r == '"'):
			inQuote = true
			quoteChar = r
			current.WriteRune(r)
		case inQuote && r == quoteChar:
			inQuote = false
			current.WriteRune(r)
		case !inQuote && r == ',':
			values = append(values, strings.TrimSpace(current.String()))
			current.Reset()
		default:
			current.WriteRune(r)
		}
	}
	
	if current.Len() > 0 {
		values = append(values, strings.TrimSpace(current.String()))
	}
	
	return values
}

func parseSetClauses(str string) map[string]string {
	result := make(map[string]string)
	pairs := strings.Split(str, ",")
	
	for _, pair := range pairs {
		parts := strings.SplitN(strings.TrimSpace(pair), "=", 2)
		if len(parts) == 2 {
			col := strings.TrimSpace(strings.Trim(parts[0], "`\""))
			val := strings.TrimSpace(parts[1])
			result[col] = val
		}
	}
	
	return result
}

func parseWhere(str string) map[string]string {
	result := make(map[string]string)
	if str == "" {
		return result
	}

	conditions := strings.Split(str, "AND")
	for _, cond := range conditions {
		parts := strings.SplitN(strings.TrimSpace(cond), "=", 2)
		if len(parts) == 2 {
			col := strings.TrimSpace(strings.Trim(parts[0], "`\""))
			val := strings.TrimSpace(parts[1])
			result[col] = val
		}
	}
	
	return result
}
