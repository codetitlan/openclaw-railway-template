#!/usr/bin/env python3
import json

def main():
    with open('sales-agent/tests/emails.json', 'r') as f:
        emails = json.load(f)
    for e in emails:
        print(json.dumps(e))

if __name__ == '__main__':
    main()
