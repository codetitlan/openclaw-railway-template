#!/usr/bin/env python3
import json, sys
def main():
lead = json.loads(sys.stdin.read())
name = lead.get('sender',{}).get('name','Lead')
subject = lead.get('subject','your inquiry')
company = lead.get('company','your company')
draft = f"Hi {name}, thanks for reaching out about {subject}. We'd love to discuss how we can help {company}."
print(json.dumps({"draft": draft}))
if __name__ == '__main__':
main()
