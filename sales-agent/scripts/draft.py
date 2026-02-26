import json, sys

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        lead = json.loads(line)
        name = lead.get("sender", {}).get("name", "Lead")
        subject = lead.get("subject", "your inquiry")
        company = lead.get("company", "your company")
        draft = "Hi {}, thanks for reaching out about {}. We would love to discuss how we can help {}.".format(name, subject, company)
        print(json.dumps({"id": lead.get("id"), "draft": draft}))

if __name__ == "__main__":
    main()
