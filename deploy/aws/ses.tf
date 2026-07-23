# --- Transactional email via SES ---------------------------------------------
# Verifies the app domain as a SES sending identity with Easy DKIM, a MAIL FROM
# subdomain (SPF alignment), and a permissive DMARC record. The app sends via the
# SDK using the task role (see iam.tf) — no SMTP credentials.
#
# NOTE: new SES accounts start in the SANDBOX — you can only send to *verified*
# addresses and are capped at 200/day. Request production access in the SES
# console (Account dashboard → Request production access) before real signups.

locals {
  ses_mail_from = "${var.ses_mail_from_subdomain}.${var.domain_name}"
  ses_from      = var.ses_from != "" ? var.ses_from : "Aldine <no-reply@${var.domain_name}>"
}

resource "aws_sesv2_email_identity" "domain" {
  count          = var.enable_ses ? 1 : 0
  email_identity = var.domain_name
}

# Easy DKIM: three CNAMEs let SES sign outbound mail as the domain.
resource "aws_route53_record" "ses_dkim" {
  count   = var.enable_ses ? 3 : 0
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# Custom MAIL FROM domain so SPF aligns with the From: domain.
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  count                  = var.enable_ses ? 1 : 0
  email_identity         = aws_sesv2_email_identity.domain[0].email_identity
  mail_from_domain       = local.ses_mail_from
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  count   = var.enable_ses ? 1 : 0
  zone_id = data.aws_route53_zone.main.zone_id
  name    = local.ses_mail_from
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  count   = var.enable_ses ? 1 : 0
  zone_id = data.aws_route53_zone.main.zone_id
  name    = local.ses_mail_from
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# Permissive DMARC — enables DKIM/SPF alignment reporting without rejecting mail.
resource "aws_route53_record" "ses_dmarc" {
  count   = var.enable_ses ? 1 : 0
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = ["v=DMARC1; p=none;"]
}
