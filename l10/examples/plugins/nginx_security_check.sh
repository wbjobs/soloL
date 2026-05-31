#!/bin/bash
#
# Example configdrift plugin - Nginx Security Checker (Shell script)
# Checks nginx config for common security issues
#

set -e

# Read JSON input from stdin
INPUT=$(cat)

# Extract stage using python (available on most systems)
STAGE=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('stage','audit'))")
HOST=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('host',''))")

if [ "$STAGE" = "audit" ]; then
    # In a real plugin, you'd SSH to the host and check the config
    # This is a demo that returns a sample finding
    cat <<'EOF'
{
    "status": "ok",
    "findings": [
        {
            "file_path": "/etc/nginx/nginx.conf",
            "severity": "info",
            "message": "Consider adding server_tokens off for security",
            "actual": "on",
            "expected": "off"
        }
    ]
}
EOF
elif [ "$STAGE" = "fix" ]; then
    cat <<'EOF'
{
    "status": "ok",
    "fixed": ["/etc/nginx/nginx.conf"],
    "failed": []
}
EOF
else
    cat <<EOF
{"status": "error", "error": "Unknown stage: $STAGE"}
EOF
    exit 1
fi
