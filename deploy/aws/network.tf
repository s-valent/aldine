data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Two AZs is enough for an ALB (it requires ≥2) and keeps the footprint small.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

# A tiny purpose-built VPC. Tasks live in PUBLIC subnets with public IPs so they
# reach ECR/GitHub/OAuth/DOI APIs directly — this deliberately avoids a NAT
# gateway (~$32/mo), the single biggest cost trap in a "cheap" AWS setup.
# Inbound is still closed: the task security group only accepts traffic from the ALB.
resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "papyr" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "papyr" }
}

resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "papyr-public-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "papyr-public" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
