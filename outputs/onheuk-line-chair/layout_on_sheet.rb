# encoding: utf-8
require 'json'

model = Sketchup.active_model
raise '다른 모델이 열려 있습니다.' unless File.basename(model.path) == 'onheuk-line-chair-350x365x570mm.skp'
source = model.entities.grep(Sketchup::Group)
raise '의자 부재 6개를 확인할 수 없습니다.' unless source.size == 6 && source.all?(&:manifold?)
raise '재단 배치가 이미 있습니다.' if model.entities.any? { |e| e.respond_to?(:name) && e.name == '라인 체어 재단 배치 · 600×2400' }
original = source.map { |g| [g, g.transformation.to_a, g.volume] }
folder = '/Users/changseok/editor/outputs/onheuk-line-chair'

panel_rotation = Geom::Transformation.axes(ORIGIN, Y_AXIS, Z_AXIS, X_AXIS)
seat_rotation = Geom::Transformation.rotation(ORIGIN, Z_AXIS, -Math::PI / 2)
rail_rotation = Geom::Transformation.axes(ORIGIN, Z_AXIS, X_AXIS, Y_AXIS)
plans = [
  ['02', nil, panel_rotation, 10, 10, 570, 350, '01 뒤판·등받이'],
  ['01', nil, panel_rotation, 584, 10, 435, 350, '02 앞판'],
  ['03', '좌', seat_rotation, 10, 364, 350, 171, '03 좌면 좌'],
  ['03', '우', seat_rotation, 364, 364, 350, 171, '04 좌면 우'],
  ['04', '좌', rail_rotation, 718, 364, 335, 60, '05 보강재 좌'],
  ['04', '우', rail_rotation, 718, 428, 335, 60, '06 보강재 우']
]
plans.each do |prefix, side, *_|
  matches = source.select { |g| g.name.start_with?(prefix) && (!side || g.name.include?(" #{side} ")) }
  raise "부재 확인 실패: #{prefix} #{side}" unless matches.size == 1
end

model.start_operation('600×2400 합판 재단 배치', true)
begin
  layout = model.entities.add_group
  layout.name = '라인 체어 재단 배치 · 600×2400'
  layout.set_attribute('cut_layout', 'sheet_mm', [2400, 600, 15])
  layout.set_attribute('cut_layout', 'kerf_mm', 4)
  layout.set_attribute('cut_layout', 'edge_margin_mm', 10)
  plywood = model.materials.add('재단 원판 · 합판 15T')
  plywood.color = Sketchup::Color.new(222, 200, 164)
  cut_material = model.materials.add('재단 부재 · 확인용 색상')
  cut_material.color = Sketchup::Color.new(177, 205, 218)
  offcut_material = model.materials.add('남는 원판')
  offcut_material.color = Sketchup::Color.new(209, 225, 201)
  kerf_material = model.materials.add('톱날 절단 여유 4mm')
  kerf_material.color = Sketchup::Color.new(200, 81, 64)
  board = layout.entities.add_group
  board.name = '합판 원판 2400×600×15mm'
  face = board.entities.add_face([[700.mm,0,-15.mm],[3100.mm,0,-15.mm],[3100.mm,600.mm,-15.mm],[700.mm,600.mm,-15.mm]])
  face.reverse! if face.normal.z < 0
  face.pushpull(15.mm)
  board.entities.grep(Sketchup::Face).each { |f| f.material = f.back_material = plywood }
  annotations = layout.entities.add_group
  annotations.name = '부재 표기·원판 치수'
  records = []
  parts = []
  plans.each do |prefix, side, rotation, x, y, width, height, label|
    src = source.find { |g| g.name.start_with?(prefix) && (!side || g.name.include?(" #{side} ")) }
    part = layout.entities.add_instance(src.definition, rotation * src.transformation)
    part.make_unique
    part.name = "#{label} #{width}×#{height}×15mm"
    b = part.bounds
    part.transform!(Geom::Transformation.translation([700.mm + x.mm - b.min.x, y.mm - b.min.y, -b.min.z]))
    part.definition.entities.grep(Sketchup::Face).each { |f| f.material = f.back_material = cut_material }
    b = part.bounds
    actual = [b.width.to_mm, b.height.to_mm, b.depth.to_mm]
    raise "치수 오류: #{label}: #{actual}" unless actual.zip([width,height,15]).all? { |a,v| (a-v).abs < 0.01 }
    raise "솔리드 오류: #{label}" unless part.manifold?
    raise "원판 경계 초과: #{label}" unless x >= 10 && y >= 10 && x+width <= 2390 && y+height <= 590
    part.set_attribute('cut_layout', 'source_part', src.name)
    annotations.entities.add_text("#{label}\n#{width} × #{height} mm", [(700+x+width/2.0).mm,(y+height/2.0).mm,16.mm])
    records << {name: label, source: src.name, x_mm: x, y_mm: y, width_mm: width, height_mm: height, thickness_mm: 15, solid: true, volume_mm3: part.volume * 25.4**3}
    parts << part
  end
  records.combination(2).each do |a,b|
    separated = a[:x_mm]+a[:width_mm]+4 <= b[:x_mm] || b[:x_mm]+b[:width_mm]+4 <= a[:x_mm] || a[:y_mm]+a[:height_mm]+4 <= b[:y_mm] || b[:y_mm]+b[:height_mm]+4 <= a[:y_mm]
    raise "절단 여유 부족: #{a[:name]}, #{b[:name]}" unless separated
  end
  offcut = layout.entities.add_group
  offcut.name = '연속 잔재 1333×600mm · 절단선 4mm 제외'
  remainder = offcut.entities.add_face([[1767.mm,0,0.1.mm],[3100.mm,0,0.1.mm],[3100.mm,600.mm,0.1.mm],[1767.mm,600.mm,0.1.mm]])
  remainder.material = remainder.back_material = offcut_material
  kerf = offcut.entities.add_face([[1763.mm,0,0.2.mm],[1767.mm,0,0.2.mm],[1767.mm,600.mm,0.2.mm],[1763.mm,600.mm,0.2.mm]])
  kerf.material = kerf.back_material = kerf_material
  annotations.entities.add_text("남는 합판\n1333 × 600 mm", [2100.mm,300.mm,1.mm])
  annotations.entities.add_text('라인 체어 · 합판 1장 재단 배치', [700.mm,730.mm,0])
  annotations.entities.add_text('600×2400×15mm  |  부재 간격 4mm  |  외곽 여유 10mm', [700.mm,670.mm,0])
  annotations.entities.add_text('슬롯·보강재 세부 치수는 사진 추정값', [700.mm,-140.mm,0])
  annotations.entities.add_dimension_linear([700.mm,0,0],[3100.mm,0,0],[0,-65.mm,0])
  annotations.entities.add_dimension_linear([700.mm,0,0],[700.mm,600.mm,0],[-65.mm,0,0])
  annotations.entities.add_dimension_linear([1767.mm,600.mm,0],[3100.mm,600.mm,0],[0,40.mm,0])
  raise '조립 원본이 변경되었습니다.' unless original.all? { |g,t,v| g.transformation.to_a == t && (g.volume-v).abs < 0.000001 }
  raise '복제 부재의 체적이 다릅니다.' unless records.all? { |r| src=source.find{|g| g.name == r[:source]}; (src.volume*25.4**3-r[:volume_mm3]).abs < 0.01 }
  model.commit_operation
rescue StandardError
  model.abort_operation
  raise
end
model.options['UnitsOptions']['LengthUnit'] = 2
model.options['UnitsOptions']['LengthFormat'] = 0
model.rendering_options['DisplaySketchAxes'] = false
model.active_view.camera = Sketchup::Camera.new([1900.mm,300.mm,3500.mm],[1900.mm,300.mm,0],[0,1,0],false)
model.active_view.zoom(layout)
model.selection.clear
destination = File.join(folder, 'onheuk-line-chair-cut-layout-600x2400.skp')
raise '파일 저장 실패' unless model.save(destination)
report = {file: destination, sheet_mm: [2400,600,15], sheet_count: 1, kerf_mm: 4, edge_margin_mm: 10, original_preserved: true, parts: records, continuous_offcut_mm: [1333,600], all_solid: true, no_overlaps: true, within_sheet: true}
File.write(File.join(folder,'cut-layout-verification.json'), JSON.pretty_generate(report))
model.active_view.write_image(filename: File.join(folder,'cut-layout-preview.png'), width: 1800, height: 800, antialias: true, transparent: false)
puts JSON.pretty_generate(report)
