await p.addStyleTag({ content: '.drive-root.real .drive-rbar > *, .drive-root.real .drive-row2 > * { opacity: 1 !important; transform: none !important; }' });
await L.shot(p, 'out/branch_foot_390b.png');
return 'ok';
