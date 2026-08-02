---
title: LocalStack으로 Terraform 연습하기
date: 2026-01-04
draft: false
tags:
  - terraform
  - localstack
  - aws
  - iac
banner: 
cssclasses: 
description: 실제 AWS 요금 걱정 없이 Terraform을 연습하려고 LocalStack으로 AWS를 로컬에 모킹하고, tflocal로 S3 버킷을 plan→apply까지 찍어본 기록.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 요약

> [!SUMMARY]
> Terraform을 익히고 싶은데 실습 대상이 AWS면 요금이 무섭다. [LocalStack](https://www.localstack.io/)은 AWS API를 로컬 컨테이너로 흉내 내줘서 진짜 AWS 없이 `terraform apply`까지 연습할 수 있다. `tflocal`(LocalStack용 래퍼)을 쓰면 엔드포인트가 자동으로 잡히므로, S3 버킷 하나를 plan→apply→확인까지 돌려봤다.

클라우드 실습은 잘못 켜두면 요금이 새는 게 늘 부담인데, 이걸로 그 걱정을 덜었다.

## 1. 도구 설치

필요한 건 도커, Terraform, AWS CLI, 그리고 LocalStack과 그 래퍼(`awslocal`, `tflocal`)다.

```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
brew install awscli
brew install --cask orbstack   # 도커가 없다면

# LocalStack 과 로컬용 래퍼
brew install localstack
brew install awscli-local       # awslocal
brew install terraform-local    # tflocal
```

`awslocal`/`tflocal`은 각각 AWS CLI·Terraform에 "LocalStack 엔드포인트로 가라"를 미리 박아둔 래퍼다. 덕분에 명령에 매번 `--endpoint-url`을 붙일 필요가 없다.

## 2. LocalStack 띄우기

`docker compose`로 LocalStack 게이트웨이(4566 포트)를 올린다.

```yaml
services:
  localstack:
    image: localstack/localstack
    ports:
      - "127.0.0.1:4566:4566"            # LocalStack 게이트웨이
      - "127.0.0.1:4510-4559:4510-4559"  # 서비스별 외부 포트 범위
    volumes:
      - "./volume:/var/lib/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
```

이제 모든 AWS API 호출이 `localhost:4566`으로 간다.

## 3. main.tf 작성

S3 버킷 하나를 만드는 최소 구성이다. 포인트는 프로바이더 설정이다.

```hcl
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region     = "us-east-1"
  access_key = "test"        # 실제 키가 아닌 더미
  secret_key = "test"
  # 실제 AWS 검증 절차를 건너뛴다 (LocalStack 대상이므로)
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
}

resource "aws_s3_bucket" "practice" {
  bucket = "my-localstack-practice-bucket"
  tags   = { Environment = "Local", Project = "Terraform-Practice" }
}

output "bucket_name" { value = aws_s3_bucket.practice.bucket }
output "bucket_arn"  { value = aws_s3_bucket.practice.arn }
```

`tflocal`을 쓰면 엔드포인트(`localhost:4566`)는 자동으로 잡히지만, 자격증명은 더미(`test`)로라도 채워야 하고 실제 AWS 검증 절차(`skip_*`)는 꺼둬야 한다. 안 그러면 프로바이더가 진짜 AWS를 검증하려다 막힌다.

## 4. init → plan → apply

```bash
tflocal init     # 프로바이더 설치(./.terraform), .terraform.lock.hcl 생성
tflocal plan     # 실행 계획 미리보기 (+ create)
tflocal apply    # terraform.tfstate 생성, 실제 생성
```

`plan`은 "무엇이 생길지"를 `+ create`로 보여주고, `apply`는 확인(`yes`) 후 실제로 만든다.

```text
aws_s3_bucket.practice: Creating...
aws_s3_bucket.practice: Creation complete after 1s [id=my-localstack-practice-bucket]

Apply complete! Resources: 1 added, 0 changed, 0 destroyed.

Outputs:
bucket_arn  = "arn:aws:s3:::my-localstack-practice-bucket"
bucket_name = "my-localstack-practice-bucket"
```

## 5. 생성 확인

`awslocal`로 LocalStack 안의 버킷을 조회하면 실제로 들어가 있다.

```bash
awslocal s3 ls
# 2026-01-04 09:54:46 my-localstack-practice-bucket
```

`plan`으로 계획을 보고 `apply`로 반영하고 CLI로 확인하는 이 한 바퀴가 Terraform의 기본 루프다. 요금 걱정 없이 이 루프를 반복하며 감을 잡을 수 있다는 게 LocalStack의 값어치였다. (온프레미스 GPU 서버를 실제로 코드로 찍어낸 이야기는 [[Terraform으로 GPU VM 찍어내기|따로]] 정리했다.)

## 참고

- [[Terraform으로 GPU VM 찍어내기]]
- [LocalStack](https://www.localstack.io/)
- [LocalStack — Terraform (tflocal)](https://docs.localstack.cloud/user-guide/integrations/terraform/)
