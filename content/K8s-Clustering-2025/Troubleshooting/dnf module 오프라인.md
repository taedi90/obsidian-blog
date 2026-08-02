---
title: 오프라인 미러에서 dnf module이 안 보일 때
date: 2025-07-18
draft: false
tags:
  - dnf
  - rhel
  - offline-install
  - troubleshooting
banner: 
cssclasses: 
description: 오프라인으로 미러링한 RHEL 저장소에서 dnf module 명령이 모듈을 못 찾던 문제. module 메타데이터(modules.yaml)를 같이 실어야 하는 이유와, 차라리 모듈을 우회하는 선택.
permalink: 
aliases: 
completed: true
type:
  - issue
---

## 요약

> [!SUMMARY]
> 오프라인으로 RPM 저장소를 미러링해 옮겼더니 `dnf module list/enable/install`이 모듈을 하나도 못 봤다. RPM 패키지만 복제하고 <b>module 메타데이터(`modules.yaml`)</b>를 안 실었기 때문이다. dnf 모듈러리티는 이 메타데이터가 저장소에 있어야 스트림을 인식한다. 해결은 둘 — 미러에 <b>modular 메타데이터를 포함</b>시키거나, 아예 모듈 기능을 우회해 <b>필요한 RPM 아티팩트만 직접 받아</b> 설치하는 것이다.

모듈은 편하지만, 오프라인에서는 "메타데이터까지 옮겼는가"가 갈림길이다.

## 1. 증상

폐쇄망에 옮긴 미러 저장소에서 모듈을 다루려는데 아무것도 안 잡혔다.

```bash
dnf module list        # 모듈이 하나도 안 나옴
dnf module enable ...   # No such module 류로 실패
```

온라인 저장소에선 되던 게 미러에선 안 되니, 패키지는 옮겨졌는데 모듈만 사라진 상태였다.

## 2. 원인: modules.yaml을 안 실었다

dnf <b>모듈러리티(AppStream 모듈)</b>는 일반 RPM 메타데이터와 별개로 <b>module 메타데이터</b>를 쓴다. 저장소의 `repodata`에 들어가는 `modules.yaml`(모듈·스트림·프로필과 그에 속한 RPM 목록을 기술)이 그것이다. `dnf module`은 이 메타데이터를 보고 "어떤 모듈의 어떤 스트림이 있는지"를 안다.

문제는 저장소를 복제할 때 RPM만 긁고 이 modular 메타데이터를 빠뜨리기 쉽다는 것이다. 그러면 패키지 파일은 다 있어도 dnf는 모듈의 존재 자체를 모른다.

## 3. 두 갈래 해결

<b>갈래 A — modular 메타데이터를 미러에 포함.</b> 저장소를 복제할 때 module 메타데이터까지 가져오고(`reposync`로 module 메타 포함), 재생성 시 `createrepo_c`에 modular 메타데이터를 합쳐 넣는다. 그러면 오프라인에서도 `dnf module`이 정상 동작한다. 모듈 스트림 전환이 실제로 필요할 때 이 길로 간다.

<b>갈래 B — 모듈을 우회하고 RPM만 직접 설치.</b> 사실 대부분은 "특정 모듈의 특정 스트림에 든 그 패키지들"이 필요할 뿐이다. 그러면 모듈 메타데이터 관리에 매달리지 말고, <b>그 모듈이 담고 있는 RPM 목록을 뽑아 해당 아티팩트만 받아</b> 미러에 넣고 그냥 설치하는 게 간단하다. 모듈 스트림 machinery를 안 건드리니 오프라인에서 걸릴 게 없다.

이번엔 스트림 전환이 필요하지 않아 <b>갈래 B</b>로 갔다 — 필요한 목록을 까서 아티팩트만 가져오는 쪽이 오프라인 관리 부담이 훨씬 적었다. (스트림을 실제로 바꿔야 하는 상황이면 A가 맞다.)

## 참고

- [[엔비디아 드라이버]]
- [dnf — Module command](https://dnf.readthedocs.io/en/latest/command_ref.html#module-command-label)
